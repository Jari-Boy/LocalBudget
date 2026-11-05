import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CreateJournalEntryInput, JournalEntry, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementTarget } from '../../domain/settlement-batch/SettlementTarget'
import { listSettlementTargetOptions } from '../../domain/settlement-batch/listSettlementTargetOptions'
import { findUnsettledSettlementBatchesForTarget } from '../../domain/settlement-batch/findUnsettledSettlementBatchesForTarget'
import {
  findUnassignedAdvanceEntriesForTarget,
  type UnassignedAdvanceEntryCandidate,
} from '../../domain/settlement/findUnassignedAdvanceEntriesForTarget'
import { buildJournalEntryUpdateWithAssignedSettlementBatch } from '../../domain/settlement/buildJournalEntryUpdateWithAssignedSettlementBatch'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { resolveSettlementAdjustment } from '../../domain/settlement/resolveSettlementAdjustment'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './SettlementScreen.css'

/**
 * 差額損益計上先の科目名(計画Issue #139)。infrastructure/db/seedSettlementAdjustmentAccounts.tsの
 * 同名の定数と一致させる必要がある(コンポーネント層からinfrastructure/dbを直接importしない方針、
 * 他のRepositoryもpropsとして注入されるのと同様に、具体的な科目idはAccountRepositoryが返す
 * 一覧から名前で解決する)。
 */
const SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME = '雑収入'
const SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME = '雑損失'

interface SettlementBatchFinder {
  findAll(): SettlementBatch[] | Promise<SettlementBatch[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
  update(id: number, input: UpdateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}
interface JournalEntryLinkGroupJoiner {
  joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void | Promise<void>
}

export interface SettlementScreenProps {
  settlementBatchRepository: SettlementBatchFinder
  accountRepository: AccountFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  journalEntryRepository: JournalEntryFinder
  journalEntryLinkGroupRepository: JournalEntryLinkGroupJoiner
  onBack: () => void
  /** 精算仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  settlementBatches: SettlementBatch[]
  accounts: Account[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  entries: JournalEntry[]
}

type SettlementSide = 'asset' | 'liability'

function parseTargetKey(key: string): SettlementTarget | null {
  if (key.startsWith('member:')) return { kind: 'householdMember', householdMemberId: Number(key.slice(7)) }
  if (key.startsWith('counterparty:')) return { kind: 'counterparty', counterpartyId: Number(key.slice(13)) }
  return null
}

function formatSignedCurrency(amount: number): string {
  return amount > 0 ? `+${formatCurrency(amount, 'JPY')}` : formatCurrency(amount, 'JPY')
}

/**
 * 精算画面(計画Issue #40、計画Issue #133でsettlement_batches・集計方式に移行、計画Issue #139で
 * 操作モデルを全面刷新)。
 *
 * 旧来の「精算バッチ・精算方向を選ぶ→精算額を入力して新規仕訳を作成する」操作モデルは完全に
 * 廃止した(FIFO自動割り振りのallocateSettlementToLinesも削除済み)。新しい操作モデルは
 * 「既存仕訳を選ぶ」が基本形になる(docs/domain/settlement.md参照)。
 *
 * 1. 「対象者」(世帯メンバー or 取引先、listSettlementTargetOptionsで候補を絞り込む)と
 *    「科目」(立替金/未払金、is_system_managedの資産・負債)を選ぶ。
 * 2. findUnsettledSettlementBatchesForTargetで、対象者・科目に一致する未精算バッチ
 *    (バッチ単位の残高)を一覧表示する。
 * 3. バッチの「消込む仕訳を選ぶ」から、findUnassignedAdvanceEntriesForTargetで絞り込んだ
 *    未割当(settlement_batch_id未設定)の候補仕訳をチェックボックスで複数選択する。
 * 4. 選択した仕訳群の金額合計とバッチ残高が一致すれば、選択した仕訳の対象行に
 *    settlement_batch_idを割り当てて精算完了する(buildJournalEntryUpdateWithAssignedSettlementBatch、
 *    JournalEntryRepository.update)。新規の仕訳は作らない。
 * 5. 不一致の場合、「未精算として残す」(タグ付けのみ)か、「精算完了」(差額を雑収入/雑損失へ
 *    損益計上する調整仕訳をbuildSettlementJournalEntryInputで追加作成し、バッチ残高を0にする、
 *    resolveSettlementAdjustmentで借方/貸方の向きを決定)かを選べる。
 * 6. 候補仕訳が0件の場合のみ、ダイアログから新規に仕訳を手動作成できる(現金でのやり取り等)。
 *
 * いずれの経路でも、タグ付け・作成した仕訳群は既存のタグ付き仕訳(taggedEntryIds)と同じ
 * 関連仕訳グループへ参加させる(JournalEntryLinkGroupRepository.joinOrCreateGroups、計画Issue #138)。
 *
 * 立替金(資産/負債)科目・差額計上科目(雑収入/雑損失)はユーザーに科目一覧から選ばせず、
 * seedAdvanceAccounts/seedSettlementAdjustmentAccountsが投入した科目を名前・is_system_managedで
 * 自動解決して使う。
 */
export function SettlementScreen({
  settlementBatchRepository,
  accountRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  onBack,
  today,
}: SettlementScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [targetKey, setTargetKey] = useState('')
  const [side, setSide] = useState<SettlementSide | ''>('')
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null)
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set())
  const [showManualDialog, setShowManualDialog] = useState(false)
  const [manualCounterAccountId, setManualCounterAccountId] = useState<number | ''>('')
  const [manualAmount, setManualAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadMasterData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementBatchRepository, accountRepository, householdMemberRepository, counterpartyRepository, journalEntryRepository])

  // 対象者・科目の候補がある場合、「未選択」のままにせず自動で選択する(都度選び直す手間を
  // 減らすため、ユーザーレビューでの指摘対応)。既にユーザーが選択済みの場合は上書きしない。
  useEffect(() => {
    if (masterData === null) return
    const assetAccountId = masterData.accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
    const liabilityAccountId =
      masterData.accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
    const accountIds = [assetAccountId, liabilityAccountId].filter((id): id is number => id !== null)
    const lines = masterData.entries.flatMap((entry) => entry.lines)
    const options = listSettlementTargetOptions(
      lines,
      masterData.settlementBatches,
      masterData.householdMembers,
      masterData.counterparties,
      accountIds,
    )
    setTargetKey((prev) => {
      if (prev !== '' || options.length === 0) return prev
      const first = options[0]!
      return `${first.kind === 'householdMember' ? 'member' : 'counterparty'}:${first.id}`
    })
    setSide((prev) => (prev !== '' ? prev : 'asset'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterData])

  function loadMasterData() {
    return Promise.all([
      Promise.resolve(settlementBatchRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
    ]).then(([settlementBatches, accounts, householdMembers, counterparties, entries]) =>
      setMasterData({ settlementBatches, accounts, householdMembers, counterparties, entries }),
    )
  }

  function closePicker() {
    setExpandedBatchId(null)
    setSelectedLineIds(new Set())
    setShowManualDialog(false)
    setManualCounterAccountId('')
    setManualAmount('')
    setError(null)
  }

  if (masterData === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const advanceAssetAccountId =
    masterData.accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId =
    masterData.accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
  const gainAccountId = masterData.accounts.find((account) => account.name === SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)?.id ?? null
  const lossAccountId = masterData.accounts.find((account) => account.name === SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME)?.id ?? null
  const counterAccounts = masterData.accounts.filter((account) => account.category === 'asset')
  const advanceAccountIds = [advanceAssetAccountId, advanceLiabilityAccountId].filter(
    (id): id is number => id !== null,
  )

  const allLines = masterData.entries.flatMap((entry) => entry.lines)
  const targetOptions = listSettlementTargetOptions(
    allLines,
    masterData.settlementBatches,
    masterData.householdMembers,
    masterData.counterparties,
    advanceAccountIds,
  )
  const target = parseTargetKey(targetKey)
  const settlementAccountId = side === 'asset' ? advanceAssetAccountId : side === 'liability' ? advanceLiabilityAccountId : null

  const unsettledBatches =
    target !== null && settlementAccountId !== null && side !== ''
      ? findUnsettledSettlementBatchesForTarget(allLines, masterData.settlementBatches, settlementAccountId, side, target)
      : null

  const expandedResult = unsettledBatches?.find((item) => item.batch.id === expandedBatchId) ?? null
  const candidates: UnassignedAdvanceEntryCandidate[] =
    expandedResult !== null && settlementAccountId !== null && target !== null
      ? findUnassignedAdvanceEntriesForTarget(masterData.entries, settlementAccountId, target)
      : []

  const selectedTotal = candidates
    .filter((candidate) => selectedLineIds.has(candidate.lineId))
    .reduce((sum, candidate) => sum + candidate.amount, 0)
  const diff = expandedResult !== null ? selectedTotal - expandedResult.balance : 0
  const matched = expandedResult !== null && selectedTotal > 0 && diff === 0
  const mismatched = expandedResult !== null && selectedTotal > 0 && diff !== 0

  function summarizeTaggedEntries(entryIds: readonly number[]): string {
    const memos = entryIds
      .map((id) => masterData!.entries.find((entry) => entry.id === id)?.memo)
      .filter((memo): memo is string => memo !== null && memo !== undefined && memo !== '')
    if (memos.length === 0) return t('entryNoMemo')
    if (memos.length === 1) return memos[0]!
    return t('batchLineSummaryMultiple', { count: memos.length })
  }

  function counterAccountNameFor(candidate: UnassignedAdvanceEntryCandidate): string {
    const otherLine = candidate.entry.lines.find((line) => line.id !== candidate.lineId)
    return masterData!.accounts.find((account) => account.id === otherLine?.accountId)?.name ?? ''
  }

  function toggleCandidate(lineId: number) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) {
        next.delete(lineId)
      } else {
        next.add(lineId)
      }
      return next
    })
  }

  function resolveEntryHouseholdMemberId(currentTarget: SettlementTarget): number | null {
    if (currentTarget.kind === 'householdMember') return currentTarget.householdMemberId
    return masterData!.householdMembers[0]?.id ?? null
  }

  async function handleAssignSelected(createAdjustment: boolean) {
    if (submitting || expandedResult === null || target === null || settlementAccountId === null || side === '') return
    const entryHouseholdMemberId = resolveEntryHouseholdMemberId(target)
    if (entryHouseholdMemberId === null) {
      setError(t('settlementSubmitError'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const selectedCandidates = candidates.filter((candidate) => selectedLineIds.has(candidate.lineId))
      const newlyTaggedEntryIds: number[] = []
      for (const candidate of selectedCandidates) {
        await Promise.resolve(
          journalEntryRepository.update(
            candidate.entry.id,
            buildJournalEntryUpdateWithAssignedSettlementBatch(candidate.entry, candidate.lineId, expandedResult.batch.id),
          ),
        )
        newlyTaggedEntryIds.push(candidate.entry.id)
      }

      if (createAdjustment && diff !== 0) {
        if (gainAccountId === null || lossAccountId === null) {
          throw new Error('差額計上科目(雑収入/雑損失)が見つかりません')
        }
        const adjustment = resolveSettlementAdjustment(diff, side)
        const adjustmentEntry = await Promise.resolve(
          journalEntryRepository.create(
            buildSettlementJournalEntryInput({
              settlementBatchId: expandedResult.batch.id,
              settlementAccountId,
              settlementAccountCategory: adjustment.effectiveCategory,
              counterAccountId: adjustment.isGain ? gainAccountId : lossAccountId,
              amount: adjustment.amount,
              settlementHouseholdMemberId: target.kind === 'householdMember' ? target.householdMemberId : null,
              entryHouseholdMemberId,
              entryDate: today ?? new Date().toISOString().slice(0, 10),
            }),
          ),
        )
        newlyTaggedEntryIds.push(adjustmentEntry.id)
      }

      if (newlyTaggedEntryIds.length > 0) {
        await Promise.resolve(
          journalEntryLinkGroupRepository.joinOrCreateGroups(expandedResult.taggedEntryIds, newlyTaggedEntryIds),
        )
      }

      closePicker()
      await loadMasterData()
    } catch {
      setError(t('settlementSubmitError'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleManualCreate() {
    if (submitting || expandedResult === null || target === null || settlementAccountId === null || side === '') return
    if (manualCounterAccountId === '' || manualAmount === '') {
      setError(t('manualEntryFieldMissingError'))
      return
    }
    const amount = Number(manualAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('manualEntryFieldMissingError'))
      return
    }
    const entryHouseholdMemberId = resolveEntryHouseholdMemberId(target)
    if (entryHouseholdMemberId === null) {
      setError(t('settlementSubmitError'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const manualEntry = await Promise.resolve(
        journalEntryRepository.create(
          buildSettlementJournalEntryInput({
            settlementBatchId: expandedResult.batch.id,
            settlementAccountId,
            settlementAccountCategory: side,
            counterAccountId: manualCounterAccountId,
            amount,
            settlementHouseholdMemberId: target.kind === 'householdMember' ? target.householdMemberId : null,
            entryHouseholdMemberId,
            entryDate: today ?? new Date().toISOString().slice(0, 10),
          }),
        ),
      )
      await Promise.resolve(
        journalEntryLinkGroupRepository.joinOrCreateGroups(expandedResult.taggedEntryIds, [manualEntry.id]),
      )
      closePicker()
      await loadMasterData()
    } catch {
      setError(t('settlementSubmitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="settlement-screen">
      <h2>{t('settlementScreenTitle')}</h2>

      <div>
        <label htmlFor="settlement-target">{t('settlementTargetLabel')}</label>
        <select
          id="settlement-target"
          value={targetKey}
          onChange={(event) => {
            setTargetKey(event.target.value)
            setExpandedBatchId(null)
            setSelectedLineIds(new Set())
            setError(null)
          }}
        >
          <option value="">{t('unselected')}</option>
          {targetOptions.map((option) => (
            <option key={`${option.kind}:${option.id}`} value={`${option.kind === 'householdMember' ? 'member' : 'counterparty'}:${option.id}`}>
              {option.kind === 'householdMember'
                ? t('settlementTargetHouseholdMemberOption', { name: option.name })
                : t('settlementTargetCounterpartyOption', { name: option.name })}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="settlement-side">{t('settlementAccountSideLabel')}</label>
        <select
          id="settlement-side"
          value={side}
          onChange={(event) => {
            setSide(event.target.value as SettlementSide | '')
            setExpandedBatchId(null)
            setSelectedLineIds(new Set())
            setError(null)
          }}
        >
          <option value="">{t('unselected')}</option>
          <option value="asset">{t('settlementAccountSideAsset')}</option>
          <option value="liability">{t('settlementAccountSideLiability')}</option>
        </select>
      </div>

      {unsettledBatches !== null &&
        (unsettledBatches.length === 0 ? (
          <p>{t('unsettledBatchesEmpty')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('batchNameHeader')}</th>
                <th>{t('batchLineSummaryHeader')}</th>
                <th>{t('batchBalanceHeader')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unsettledBatches.map(({ batch, balance, taggedEntryIds }) => (
                <tr key={batch.id}>
                  <td>{batch.name}</td>
                  <td>{summarizeTaggedEntries(taggedEntryIds)}</td>
                  <td>{formatCurrency(balance, 'JPY')}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedBatchId(batch.id)
                        setSelectedLineIds(new Set())
                        setShowManualDialog(false)
                        setError(null)
                      }}
                    >
                      {t('pickEntriesButton')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {expandedResult !== null && (
        <div className="settlement-picker">
          <h3>{t('pickerTitle', { batchName: expandedResult.batch.name })}</h3>
          <p>{t('pickerDescription')}</p>

          {candidates.length === 0 ? (
            <>
              <p>{t('candidatesEmpty')}</p>
              <p>{t('manualEntryHint')}</p>
              {!showManualDialog ? (
                <button
                  type="button"
                  onClick={() => {
                    setManualAmount(String(expandedResult.balance))
                    setShowManualDialog(true)
                  }}
                >
                  {t('manualEntryButton')}
                </button>
              ) : (
                <div className="settlement-manual-entry">
                  <h4>{t('manualEntryDialogTitle')}</h4>
                  <label htmlFor="manual-counter-account">{t('counterAccountLabel')}</label>
                  <select
                    id="manual-counter-account"
                    value={manualCounterAccountId}
                    onChange={(event) =>
                      setManualCounterAccountId(event.target.value === '' ? '' : Number(event.target.value))
                    }
                  >
                    <option value="">{t('unselected')}</option>
                    {counterAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="manual-amount">{t('manualEntryAmountLabel')}</label>
                  <input
                    id="manual-amount"
                    type="number"
                    value={manualAmount}
                    onChange={(event) => setManualAmount(event.target.value)}
                  />

                  {error !== null && <p role="alert">{error}</p>}

                  <button type="button" disabled={submitting} onClick={() => void handleManualCreate()}>
                    {t('manualEntryConfirmButton')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>{t('candidateDateHeader')}</th>
                    <th>{t('candidateCounterAccountHeader')}</th>
                    <th>{t('candidateAmountHeader')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.lineId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedLineIds.has(candidate.lineId)}
                          onChange={() => toggleCandidate(candidate.lineId)}
                          aria-label={t('selectCandidateCheckboxLabel', {
                            memo: candidate.entry.memo ?? t('entryNoMemo'),
                          })}
                        />
                      </td>
                      <td>{candidate.entry.entryDate}</td>
                      <td>{counterAccountNameFor(candidate)}</td>
                      <td>{formatCurrency(candidate.amount, 'JPY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div
                className={
                  matched
                    ? 'settlement-summary settlement-summary-matched'
                    : mismatched
                      ? 'settlement-summary settlement-summary-mismatched'
                      : 'settlement-summary'
                }
              >
                <span>
                  {t('selectedTotalLabel')}: {formatCurrency(selectedTotal, 'JPY')}
                </span>
                <span>
                  {t('batchBalanceLabel')}: {formatCurrency(expandedResult.balance, 'JPY')}
                </span>
                <span>
                  {selectedTotal === 0
                    ? t('summaryNoSelection')
                    : matched
                      ? `✓ ${t('summaryMatched')}`
                      : `⚠ ${t('summaryMismatched', { diff: formatSignedCurrency(diff) })}`}
                </span>

                {error !== null && <p role="alert">{error}</p>}

                {matched && (
                  <button type="button" disabled={submitting} onClick={() => void handleAssignSelected(false)}>
                    {t('completeSettlementButton')}
                  </button>
                )}
                {mismatched && (
                  <>
                    <button type="button" disabled={submitting} onClick={() => void handleAssignSelected(false)}>
                      {t('leaveUnsettledButton')}
                    </button>
                    <button type="button" disabled={submitting} onClick={() => void handleAssignSelected(true)}>
                      {t('completeSettlementButton')}
                    </button>
                    <p className="settlement-mismatch-note">
                      {t('mismatchAdjustmentNote', {
                        accountName: resolveSettlementAdjustment(diff, side as SettlementSide).isGain
                          ? masterData.accounts.find((a) => a.id === gainAccountId)?.name ?? SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME
                          : masterData.accounts.find((a) => a.id === lossAccountId)?.name ?? SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME,
                      })}
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          <button type="button" onClick={closePicker}>
            {t('closePickerButton')}
          </button>
        </div>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
