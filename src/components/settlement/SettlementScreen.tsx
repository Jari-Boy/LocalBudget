import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { findUnsettledSettlementBatchBalances } from '../../domain/settlement-batch/findUnsettledSettlementBatchBalances'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './SettlementScreen.css'

interface SettlementBatchFinder {
  findAll(): SettlementBatch[] | Promise<SettlementBatch[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

export interface SettlementScreenProps {
  settlementBatchRepository: SettlementBatchFinder
  accountRepository: AccountFinder
  householdMemberRepository: HouseholdMemberFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
  /** 精算仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  settlementBatches: SettlementBatch[]
  accounts: Account[]
  householdMembers: HouseholdMember[]
}

type SettlementSide = 'asset' | 'liability'

/** 画面の1行(精算バッチ内で、世帯メンバーごとに集計した未精算残高の単位) */
interface SettlementRow {
  key: string
  householdMemberId: number
  balance: number
}

/**
 * 精算(立替金の消込)画面(計画Issue #40、計画Issue #133でsettlement_batches・集計方式に移行)。
 * 対象の精算バッチ・精算方向(資産/負債)を選択すると、
 * findUnsettledSettlementBatchBalances(settlement_batch_id・科目・世帯メンバーでグルーピングした
 * 未精算残高の集計、docs/domain/settlement.md参照)で未精算残高を世帯メンバーごとの行として
 * 一覧表示する。各行の「精算する」操作で実際の入出金口座・金額を指定し、
 * buildSettlementJournalEntryInput(一時勘定の区分に応じて借方/貸方を決定、settlement_batch_idを
 * タグ付与するのみ)で組み立てた精算仕訳を起票する。journal_entry_linksによる明示的な消込リンクは
 * 作らない(計画Issue #133)。
 *
 * 立替金(資産/負債)科目はユーザーに選択させず、seedAdvanceAccounts(docs/domain/
 * expense-splitting.md 1.2節)が投入したis_system_managed科目を自動解決して使う
 * (計画Issue #40、人間レビューでの追加指摘への対応)。ただし精算画面では資産側
 * (自分が立て替えた分を受け取る)・負債側(自分が立て替えてもらった分を支払う)の
 * どちらを精算するかという実質的な選択は残るため、科目名ではなく「精算方向」という
 * 2択(SettlementSide)をユーザーに選ばせ、対応する科目idへ変換する。
 */
export function SettlementScreen({
  settlementBatchRepository,
  accountRepository,
  householdMemberRepository,
  journalEntryRepository,
  onBack,
  today,
}: SettlementScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [settlementBatchId, setSettlementBatchId] = useState<number | null>(null)
  const [settlementSide, setSettlementSide] = useState<SettlementSide | null>(null)
  const [unsettledRows, setUnsettledRows] = useState<SettlementRow[] | null>(null)
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [counterAccountId, setCounterAccountId] = useState<number | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      Promise.resolve(settlementBatchRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
    ]).then(([settlementBatches, accounts, householdMembers]) =>
      setMasterData({ settlementBatches, accounts, householdMembers }),
    )
  }, [settlementBatchRepository, accountRepository, householdMemberRepository])

  const loadUnsettled = (targetBatchId: number, targetSettlementAccountId: number, side: SettlementSide) => {
    void Promise.resolve(journalEntryRepository.findAll()).then((allEntries) => {
      const allLines = allEntries.flatMap((entry) => entry.lines)
      const balances = findUnsettledSettlementBatchBalances(allLines, targetBatchId, targetSettlementAccountId, side)
      setUnsettledRows(
        balances
          .filter((balance) => balance.householdMemberId !== null)
          .map((balance) => ({
            key: `${balance.householdMemberId}`,
            householdMemberId: balance.householdMemberId!,
            balance: balance.balance,
          })),
      )
    })
  }

  if (masterData === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const counterAccounts = masterData.accounts.filter((account) => account.category === 'asset')
  /**
   * 立替金(資産/負債)科目はユーザーに科目一覧から選ばせず、seedAdvanceAccountsが
   * 投入したis_system_managed科目を自動解決する(SettlementScreenのJSDoc参照)。
   */
  const advanceAssetAccountId =
    masterData.accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId =
    masterData.accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
  const settlementAccountIdBySide: Record<SettlementSide, number | null> = {
    asset: advanceAssetAccountId,
    liability: advanceLiabilityAccountId,
  }
  const settlementAccountId = settlementSide === null ? null : settlementAccountIdBySide[settlementSide]

  function memberName(householdMemberId: number): string {
    return masterData!.householdMembers.find((member) => member.id === householdMemberId)?.name ?? ''
  }

  function handleSelectBatch(nextBatchId: number | null) {
    setSettlementBatchId(nextBatchId)
    setUnsettledRows(null)
    setExpandedRowKey(null)
    if (nextBatchId !== null && settlementAccountId !== null && settlementSide !== null) {
      loadUnsettled(nextBatchId, settlementAccountId, settlementSide)
    }
  }

  function handleSelectSettlementSide(nextSide: SettlementSide | null) {
    setSettlementSide(nextSide)
    setUnsettledRows(null)
    setExpandedRowKey(null)
    const nextAccountId = nextSide === null ? null : settlementAccountIdBySide[nextSide]
    if (settlementBatchId !== null && nextAccountId !== null && nextSide !== null) {
      loadUnsettled(settlementBatchId, nextAccountId, nextSide)
    }
  }

  function openSettleForm(rowKey: string) {
    setExpandedRowKey(rowKey)
    setCounterAccountId(null)
    setAmountInput('')
    setError(null)
  }

  async function handleSettle(row: SettlementRow) {
    if (submitting || settlementAccountId === null || settlementSide === null || settlementBatchId === null) return
    if (counterAccountId === null) {
      setError(t('settlementFieldMissingError'))
      return
    }
    const amount = Number(amountInput)
    if (amountInput === '' || !Number.isFinite(amount) || amount <= 0) {
      setError(t('settlementFieldMissingError'))
      return
    }

    const input = buildSettlementJournalEntryInput({
      settlementBatchId,
      settlementAccountId,
      settlementAccountCategory: settlementSide,
      counterAccountId,
      amount,
      householdMemberId: row.householdMemberId,
      entryDate: today ?? new Date().toISOString().slice(0, 10),
    })

    setSubmitting(true)
    setError(null)
    try {
      await journalEntryRepository.create(input)
      setExpandedRowKey(null)
      loadUnsettled(settlementBatchId, settlementAccountId, settlementSide)
    } catch {
      setError(t('submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="settlement-screen">
      <h2>{t('settlementScreenTitle')}</h2>

      <div>
        <label htmlFor="settlement-batch">{t('projectLabel')}</label>
        <select
          id="settlement-batch"
          value={settlementBatchId ?? ''}
          onChange={(event) => handleSelectBatch(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value="">{t('unselected')}</option>
          {masterData.settlementBatches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="settlement-account">{t('settlementSideLabel')}</label>
        <select
          id="settlement-account"
          value={settlementSide ?? ''}
          onChange={(event) =>
            handleSelectSettlementSide(event.target.value === '' ? null : (event.target.value as SettlementSide))
          }
        >
          <option value="">{t('unselected')}</option>
          <option value="asset">{t('settlementSideReceive')}</option>
          <option value="liability">{t('settlementSidePay')}</option>
        </select>
      </div>

      {unsettledRows !== null &&
        (unsettledRows.length === 0 ? (
          <p>{t('unsettledEntryListEmpty')}</p>
        ) : (
          <ul>
            {unsettledRows.map((row) => (
              <li key={row.key}>
                <div className="settlement-entry-row">
                  <span>{memberName(row.householdMemberId)}</span>
                  <span>{formatCurrency(row.balance, 'JPY')}</span>
                  <button type="button" onClick={() => openSettleForm(row.key)}>
                    {t('settleButton')}
                  </button>
                </div>

                {expandedRowKey === row.key && (
                  <div className="settlement-entry-form">
                    <label htmlFor={`settlement-counter-account-${row.key}`}>{t('counterAccountLabel')}</label>
                    <select
                      id={`settlement-counter-account-${row.key}`}
                      value={counterAccountId ?? ''}
                      onChange={(event) =>
                        setCounterAccountId(event.target.value === '' ? null : Number(event.target.value))
                      }
                    >
                      <option value="">{t('unselected')}</option>
                      {counterAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>

                    <label htmlFor={`settlement-amount-${row.key}`}>{t('settlementAmountLabel')}</label>
                    <input
                      id={`settlement-amount-${row.key}`}
                      type="number"
                      value={amountInput}
                      onChange={(event) => setAmountInput(event.target.value)}
                    />

                    {error !== null && <p role="alert">{error}</p>}

                    <button type="button" disabled={submitting} onClick={() => void handleSettle(row)}>
                      {t('confirmSettlement')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
