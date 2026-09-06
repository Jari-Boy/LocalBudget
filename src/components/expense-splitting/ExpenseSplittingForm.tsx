import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { CreateJournalEntryInput, JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { Project } from '../../domain/project/Project'
import { buildExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/buildExpenseSplittingJournalEntryInputs'
import { findExpenseLine } from '../../domain/expense-splitting/findExpenseLine'
import { mergeExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/mergeExpenseSplittingJournalEntryInputs'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { CounterpartyQuickAddSelect } from '../counterparty-management/CounterpartyQuickAddSelect'
import {
  calculateParticipantAmounts,
  toExpenseSplitRecipients,
  toExpenseSplitRecipientsForEntryAmount,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'
import './ExpenseSplittingForm.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface ProjectCreator {
  create(input: { name: string; kind?: Project['kind'] }): Project | Promise<Project>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}
interface CounterpartyCreator {
  create(input: { name: string }): Counterparty | Promise<Counterparty>
}
interface JournalEntryCreator {
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

export interface ExpenseSplittingFormProps {
  /**
   * 割勘対象として選択済みの元の支出仕訳(1件以上)。複数選択時は、分担者設定
   * (相手・配分方法)を共通のまま、元仕訳ごとに独立した割勘仕訳をまとめて作成する
   * (計画Issue #40、人間レビューでの再指摘への対応)。
   */
  originalEntries: JournalEntry[]
  accountRepository: AccountFinder
  projectRepository: ProjectFinder & ProjectCreator
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder & CounterpartyCreator
  journalEntryRepository: JournalEntryCreator
  onComplete: (createdEntries: JournalEntry[]) => void
  onBack: () => void
  /** 割勘仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

/**
 * 割勘仕訳の摘要欄の既定値(計画Issue #40、人間レビューでの指摘対応)。1件の元仕訳選択時は
 * 従来通り「元の摘要+の割勘」(元仕訳に摘要が無ければ空文字、無題のまま確定できる)。
 * 複数選択時は元仕訳ごとに摘要が異なりうるため、件数ベースの汎用的な既定値にする。
 * あくまで摘要欄の初期表示値であり、ユーザーが自由に上書きできる。
 */
function computeDefaultMemo(
  entries: readonly JournalEntry[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (entries.length === 1) {
    const memo = entries[0].memo
    return memo === null ? '' : t('splitMemoTemplate', { memo })
  }
  return t('splitMemoTemplateMultiple', { count: entries.length })
}

/**
 * 割勘起票フォーム(計画Issue #40)。世帯メンバー間(docs/domain/expense-splitting.md
 * 1.3節)・世帯外相手(同1.4節)との割勘を、複式簿記の概念(借方/貸方・仕訳明細)を
 * 見せない単一フォームで起票する。ユーザーが入力するのは「元の支出仕訳(originalEntries、
 * 呼び出し元が選択済み)」「参加する相手(世帯メンバー・世帯外相手の混在可)」
 * 「配分方法(均等割/カスタム比率/金額直接指定)」の3点のみで、立替者(元仕訳の起票者)・
 * 費用科目・立替金科目・仕訳の組み立て方(何件の仕訳に分解するか等)はすべて自動的に
 * 解決する。バックエンドが複数人割勘を複数の2者間仕訳として実現している(下記)という
 * 内部表現は、UIの入力方式には一切影響しない(人間レビューでの指摘、計画Issue #40
 * 再実装分: 「元の仕訳・参加メンバー・配分方法さえ決まれば、誰から誰にどの科目で
 * いくら割り振るかは自動で決まるべきで、内部の仕訳分解方式を理由にUI側へ入力させる
 * のはナンセンス」)。
 *
 * 参加者の選び方: 世帯メンバー(立替者を除く)は、割り振り可能な全員をチェックボックス
 * の一覧として常時表示する(小規模な既知集合のため、行の追加操作も「相手の種類」
 * のような分類選択も不要)。世帯外の相手は取引先マスタからの選択が必要な性質上、
 * 行を追加するインターフェースを維持するが、追加された行は常にkind='counterparty'
 * であり、ここでも「相手の種類」選択はしない(行の由来自体がkindを一意に決める、
 * expenseSplittingFormParticipant.ts参照)。配分方法を選ぶと計算結果をamountInputへ
 * 反映し、確定前に手動修正できる編集可能なプレビューとして提示する。確定操作では、
 * 立替者を除いた分担者ごとにbuildExpenseSplittingJournalEntryInputsで個別に組み立てた
 * 仕訳(分担者数×選択した元仕訳数)を、mergeExpenseSplittingJournalEntryInputsで
 * 1件の複合仕訳へ統合してから作成する(人間レビューでの指摘「割勘の仕訳を作るときは
 * 複数明細をまとめて一本で仕訳を切るように(逆仕訳が切りやすくなるから)」への対応、
 * 計画Issue #40)。1.3・1.4節の2者間仕訳パターン自体は変更しない。
 *
 * 仕訳の摘要は、1件の元仕訳選択時は「元の摘要+の割勘」、複数選択時は「N件の支出の割勘」を
 * 既定値として摘要欄に表示し、ユーザーが自由に編集できる(人間レビューでの指摘「割勘仕訳の
 * タイトルは任意で設定できるように。特になければデフォルトの設定が使用される」への対応)。
 *
 * 立替金(資産/負債)科目はユーザーに選択させず、seedAdvanceAccounts(docs/domain/
 * expense-splitting.md 1.2節「科目自体は割勘のたびに新規作成しない」)が投入した
 * is_system_managed科目を自動解決して使う(計画Issue #40、人間レビューでの追加指摘への
 * 対応)。「割勘バッチ」という独自の呼称は使わず、既存のプロジェクト管理画面(D6)と同じ
 * 「プロジェクト」という用語に統一する(同一エンティティが画面によって別名で呼ばれる
 * 不整合の解消)。
 *
 * 元の支出仕訳(originalEntries)は複数選択できる(計画Issue #40、人間レビューでの
 * 再指摘への対応)。単一選択時は、分担者ごとの按分額(プレビュー欄)をユーザーが確定前に
 * 手動修正でき、その値がそのまま使われる(toExpenseSplitRecipients)。複数選択時は
 * 元仕訳ごとに金額が異なるため、単一の按分額を手動編集する形は成立せず、共通の分担者
 * 設定(相手・配分方法・比率)を元仕訳ごとの金額に対して個別に計算し直す
 * (toExpenseSplitRecipientsForEntryAmount)。これに伴い、複数選択時は「按分する金額」欄
 * (単一選択時のみ意味を持つ)と配分方法「金額を直接指定する」(元仕訳ごとに異なる金額へ
 * 単一の固定額を割り当てる自然な意味が無い)を非表示にする。
 */
export function ExpenseSplittingForm({
  originalEntries,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  onComplete,
  onBack,
  today,
}: ExpenseSplittingFormProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const isBatch = originalEntries.length > 1

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [allocationMode, setAllocationMode] = useState<ExpenseSplittingAllocationMode>('equal')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [memoInput, setMemoInput] = useState(() => computeDefaultMemo(originalEntries, t))

  const rowKeyRef = useRef(0)
  const [participants, setParticipants] = useState<ExpenseSplittingParticipantRow[]>(() => [])

  const [totalAmountInput, setTotalAmountInput] = useState<string>('')

  if (masterData === null) {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([accounts, projects, householdMembers, counterparties]) => {
      if (originalEntries.length === 1) {
        const expenseLine = findExpenseLine(originalEntries[0], accounts)
        setTotalAmountInput(expenseLine ? String(expenseLine.amount) : '')
      }
      setMasterData({ accounts, projects, householdMembers, counterparties })
    })
    return <p role="status">{tCommon('loading')}</p>
  }

  // 以降のネストした関数(handleCalculate/handleSubmit)からmasterDataを参照すると、TSの
  // narrowingがクロージャ境界を越えて効かず"possibly null"エラーになるため、ここで
  // 非nullであることが確定した参照をローカル変数へ退避しておく。
  const accounts = masterData.accounts
  /**
   * 立替金(資産/負債)科目はユーザーに選択させず、seedAdvanceAccounts(db.worker.ts、
   * docs/domain/expense-splitting.md 1.2節)が投入したis_system_managed科目を自動解決する。
   * 通常のUI操作ではWorker起動時に必ず投入済みのため常に見つかるが、投入前のテストDB等では
   * 見つからない場合があり、その場合はnullのままhandleSubmitでエラーとする。
   */
  const advanceAssetAccountId = accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId =
    accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
  const settlementProjects = masterData.projects.filter((project) => project.kind === 'settlement')
  /** 世帯メンバーの選択肢から、選択中の元仕訳いずれかの立替者を除外する(自分自身との割勘を防ぐ) */
  const payerMemberIds = new Set(originalEntries.map((entry) => entry.householdMemberId))
  const eligibleHouseholdMembers = masterData.householdMembers.filter((member) => !payerMemberIds.has(member.id))
  const counterpartyRows = participants.filter((row) => row.kind === 'counterparty')

  function updateRow(key: number, updater: (row: ExpenseSplittingParticipantRow) => ExpenseSplittingParticipantRow) {
    setParticipants((prev) => prev.map((row) => (row.key === key ? updater(row) : row)))
  }

  /**
   * 世帯メンバーのチェックボックスを切り替える。チェックすると分担者として追加し、
   * 外すと除外する。「相手の種類」を選ばせず、チェックボックスの由来自体がkindを決める
   * (人間レビューでの指摘、コンポーネント先頭のJSDoc参照)。
   */
  function toggleHouseholdMember(memberId: number) {
    setParticipants((prev) => {
      const existingIndex = prev.findIndex((row) => row.kind === 'householdMember' && row.targetId === memberId)
      if (existingIndex !== -1) {
        return prev.filter((_, index) => index !== existingIndex)
      }
      rowKeyRef.current += 1
      return [...prev, { key: rowKeyRef.current, kind: 'householdMember', targetId: memberId, ratioInput: '', amountInput: '' }]
    })
  }

  /** 世帯外の相手を分担者として追加する。取引先マスタからの検索が必要なため、行を追加する形を維持する */
  function addCounterpartyRow() {
    rowKeyRef.current += 1
    setParticipants((prev) => [
      ...prev,
      { key: rowKeyRef.current, kind: 'counterparty', targetId: null, ratioInput: '', amountInput: '' },
    ])
  }

  function removeRow(key: number) {
    setParticipants((prev) => prev.filter((row) => row.key !== key))
  }

  function handleCalculate() {
    if (!isBatch) {
      const totalAmount = Number(totalAmountInput)
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) return
      const amounts = calculateParticipantAmounts(totalAmount, participants, allocationMode)
      setParticipants((prev) =>
        prev.map((row) => ({ ...row, amountInput: String(amounts.get(String(row.key)) ?? 0) })),
      )
      return
    }

    // 元仕訳ごとに金額が異なるため、元仕訳ごとに個別計算した按分額を合計してプレビューに表示する
    const totals = new Map<string, number>()
    for (const entry of originalEntries) {
      const expenseLine = findExpenseLine(entry, accounts)
      if (expenseLine === undefined) continue
      const amounts = calculateParticipantAmounts(expenseLine.amount, participants, allocationMode)
      for (const [key, amount] of amounts) {
        totals.set(key, (totals.get(key) ?? 0) + amount)
      }
    }
    setParticipants((prev) => prev.map((row) => ({ ...row, amountInput: String(totals.get(String(row.key)) ?? 0) })))
  }

  async function handleSubmit() {
    if (submitting) return
    setError(null)

    const entryLines: { entry: JournalEntry; expenseLine: JournalLine }[] = []
    for (const entry of originalEntries) {
      const expenseLine = findExpenseLine(entry, accounts)
      if (expenseLine === undefined) {
        setError(t('expenseAccountNotFoundError'))
        return
      }
      entryLines.push({ entry, expenseLine })
    }

    if (advanceAssetAccountId === null || projectId === null) {
      setError(t('requiredFieldMissingError'))
      return
    }

    /**
     * 世帯メンバー分担者はadvanceLiabilityAccountIdが無いと仕訳を組み立てられない
     * (toExpenseSplitRecipients/toExpenseSplitRecipientsForEntryAmountが黙って除外する)。
     * ここで事前に検証しないと、世帯外相手の行が1件でも有効な場合にnoRecipientErrorを
     * すり抜け、世帯メンバー分の割勘だけが無警告で消失したまま確定されてしまう
     * (evaluatorレビュー指摘、計画Issue #40 Review Attempt 1対応)。
     */
    const hasHouseholdMemberParticipant = participants.some(
      (row) => row.kind === 'householdMember' && row.targetId !== null,
    )
    if (hasHouseholdMemberParticipant && advanceLiabilityAccountId === null) {
      setError(t('advanceLiabilityAccountRequiredError'))
      return
    }

    /**
     * 世帯外の相手の行はtargetId(取引先)が無いと仕訳を組み立てられない
     * (toExpenseSplitRecipients/toExpenseSplitRecipientsForEntryAmountが黙って除外する)。
     * 上記の立替金(負債)科目の検証と同じ理由で、ここで事前に検証しないと、他に有効な
     * 分担者がいる場合にnoRecipientErrorをすり抜け、相手未選択の行だけが無警告で
     * 消失したまま確定されてしまう(人間レビューでの指摘、計画Issue #40)。
     */
    const hasIncompleteCounterpartyParticipant = participants.some(
      (row) => row.kind === 'counterparty' && row.targetId === null,
    )
    if (hasIncompleteCounterpartyParticipant) {
      setError(t('counterpartyTargetRequiredError'))
      return
    }

    const entryDate = today ?? new Date().toISOString().slice(0, 10)
    const perEntryInputs: CreateJournalEntryInput[] = []
    for (const { entry, expenseLine } of entryLines) {
      const recipients = isBatch
        ? toExpenseSplitRecipientsForEntryAmount(participants, advanceLiabilityAccountId, expenseLine.amount, allocationMode)
        : toExpenseSplitRecipients(participants, advanceLiabilityAccountId)
      if (recipients.length === 0) {
        setError(t('noRecipientError'))
        return
      }
      perEntryInputs.push(
        ...buildExpenseSplittingJournalEntryInputs({
          originalEntryId: entry.id,
          expenseAccountId: expenseLine.accountId,
          advanceAssetAccountId,
          fromMemberId: entry.householdMemberId,
          projectId,
          entryDate,
          recipients,
        }),
      )
    }

    /**
     * 分担者数×選択した元仕訳数だけ個別に組み立てたCreateJournalEntryInputを、
     * 1件の複合仕訳へ統合する(人間レビューでの指摘「割勘の仕訳を作るときは複数明細を
     * まとめて一本で仕訳を切るように(逆仕訳が切りやすくなるから)」への対応、計画Issue #40)。
     * 摘要はmemoInput(既定値はcomputeDefaultMemo、ユーザーが自由に編集できる)を使い、
     * 空欄のまま確定した場合はnull(無題)とする。起票者は選択した元仕訳のうち先頭のものの
     * householdMemberIdを使う(全行に明示的なhousehold_member_idが設定されるため、
     * 実効メンバーの解決においてこの値がフォールバックとして参照されることはない)。
     */
    const mergedInput = mergeExpenseSplittingJournalEntryInputs({
      inputs: perEntryInputs,
      entryDate,
      memo: memoInput.trim() === '' ? null : memoInput,
      householdMemberId: originalEntries[0].householdMemberId,
    })

    setSubmitting(true)
    try {
      const created = await journalEntryRepository.create(mergedInput)
      onComplete([created])
    } catch {
      setError(t('submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="expense-splitting-form">
      <h2>{t('formTitle')}</h2>

      <ul className="expense-splitting-original-entries">
        {originalEntries.map((entry) => {
          const expenseLine = findExpenseLine(entry, accounts)
          return (
            <li key={entry.id}>
              <span>{entry.entryDate}</span>
              <span>{entry.memo ?? t('entryNoMemo')}</span>
              {expenseLine !== undefined && <span>{formatCurrency(expenseLine.amount, 'JPY')}</span>}
            </li>
          )
        })}
      </ul>

      <div>
        <label htmlFor="expense-splitting-memo">{t('memoLabel')}</label>
        <input
          id="expense-splitting-memo"
          type="text"
          value={memoInput}
          onChange={(event) => setMemoInput(event.target.value)}
        />
      </div>

      <ProjectQuickAddSelect
        id="expense-splitting-project"
        label={t('projectLabel')}
        value={projectId}
        projects={settlementProjects}
        onChange={setProjectId}
        onCreate={async (name) => {
          const created = await projectRepository.create({ name, kind: 'settlement' })
          setMasterData((prev) => (prev === null ? prev : { ...prev, projects: [...prev.projects, created] }))
          return created
        }}
      />

      {!isBatch && (
        <div>
          <label htmlFor="expense-splitting-total-amount">{t('totalAmountLabel')}</label>
          <input
            id="expense-splitting-total-amount"
            type="number"
            value={totalAmountInput}
            onChange={(event) => setTotalAmountInput(event.target.value)}
          />
        </div>
      )}

      <div>
        <label htmlFor="expense-splitting-allocation-mode">{t('allocationModeLabel')}</label>
        <select
          id="expense-splitting-allocation-mode"
          value={allocationMode}
          onChange={(event) => setAllocationMode(event.target.value as ExpenseSplittingAllocationMode)}
        >
          <option value="equal">{t('allocationModeEqual')}</option>
          <option value="ratio">{t('allocationModeRatio')}</option>
          {!isBatch && <option value="amount">{t('allocationModeAmount')}</option>}
        </select>
      </div>

      <fieldset>
        <legend>{t('householdMemberParticipantsLabel')}</legend>
        {eligibleHouseholdMembers.length === 0 ? (
          <p>{t('noEligibleHouseholdMembers')}</p>
        ) : (
          eligibleHouseholdMembers.map((member) => {
            const row = participants.find((p) => p.kind === 'householdMember' && p.targetId === member.id)
            const idPrefix = `expense-splitting-household-${member.id}`
            return (
              <div key={member.id} role="group" aria-label={member.name} className="expense-splitting-household-member-row">
                <label>
                  <input type="checkbox" checked={row !== undefined} onChange={() => toggleHouseholdMember(member.id)} />
                  {member.name}
                </label>

                {row !== undefined && (
                  <>
                    {allocationMode === 'ratio' && (
                      <>
                        <label htmlFor={`${idPrefix}-ratio`}>{t('participantRatioLabel')}</label>
                        <input
                          id={`${idPrefix}-ratio`}
                          type="number"
                          value={row.ratioInput}
                          onChange={(event) =>
                            updateRow(row.key, (current) => ({ ...current, ratioInput: event.target.value }))
                          }
                        />
                      </>
                    )}

                    <label htmlFor={`${idPrefix}-amount`}>{t('participantAmountLabel')}</label>
                    <input
                      id={`${idPrefix}-amount`}
                      type="number"
                      value={row.amountInput}
                      readOnly={allocationMode !== 'amount'}
                      onChange={(event) =>
                        updateRow(row.key, (current) => ({ ...current, amountInput: event.target.value }))
                      }
                    />
                  </>
                )}
              </div>
            )
          })
        )}
      </fieldset>

      <fieldset>
        <legend>{t('counterpartyParticipantsLabel')}</legend>
        {counterpartyRows.map((row, index) => {
          const idPrefix = `expense-splitting-counterparty-${row.key}`
          return (
            <fieldset key={row.key}>
              <legend>{t('counterpartyParticipantGroupLabel', { index: index + 1 })}</legend>

              <CounterpartyQuickAddSelect
                id={`${idPrefix}-target`}
                label={t('participantTargetLabel')}
                value={row.targetId}
                counterparties={masterData.counterparties}
                i18nNamespace="expenseSplitting"
                onChange={(targetId) => updateRow(row.key, (current) => ({ ...current, targetId }))}
                onCreate={async (name) => {
                  const created = await counterpartyRepository.create({ name })
                  setMasterData((prev) =>
                    prev === null ? prev : { ...prev, counterparties: [...prev.counterparties, created] },
                  )
                  return created
                }}
              />

              {allocationMode === 'ratio' && (
                <>
                  <label htmlFor={`${idPrefix}-ratio`}>{t('participantRatioLabel')}</label>
                  <input
                    id={`${idPrefix}-ratio`}
                    type="number"
                    value={row.ratioInput}
                    onChange={(event) =>
                      updateRow(row.key, (current) => ({ ...current, ratioInput: event.target.value }))
                    }
                  />
                </>
              )}

              <label htmlFor={`${idPrefix}-amount`}>{t('participantAmountLabel')}</label>
              <input
                id={`${idPrefix}-amount`}
                type="number"
                value={row.amountInput}
                readOnly={allocationMode !== 'amount'}
                onChange={(event) =>
                  updateRow(row.key, (current) => ({ ...current, amountInput: event.target.value }))
                }
              />

              <button type="button" onClick={() => removeRow(row.key)}>
                {t('removeParticipant')}
              </button>
            </fieldset>
          )
        })}

        <button type="button" onClick={addCounterpartyRow}>
          {t('addCounterpartyParticipant')}
        </button>
      </fieldset>

      {allocationMode !== 'amount' && (
        <button type="button" onClick={handleCalculate}>
          {t('calculate')}
        </button>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={onBack} disabled={submitting}>
          {t('back')}
        </button>
        <button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {t('confirmSplit')}
        </button>
      </div>
    </div>
  )
}

/** プロジェクトセレクトの「+ 新しいプロジェクトを作成する」を表す特殊値。project idと衝突しない文字列を使う */
const NEW_PROJECT_OPTION_VALUE = '__new__'

interface ProjectQuickAddSelectProps {
  id: string
  label: string
  value: number | null
  projects: readonly Project[]
  onChange: (projectId: number | null) => void
  /** プロジェクト(kind='settlement')を新規作成する。作成後のprojects一覧への反映は呼び出し元の責務 */
  onCreate: (name: string) => Promise<Project>
}

/**
 * プロジェクト(kind='settlement')セレクト(計画Issue #40)。既存の
 * CounterpartyQuickAddSelect(src/components/counterparty-management/CounterpartyQuickAddSelect.tsx)
 * と同じ「その場作成(quick add)」パターンを踏襲し、既存プロジェクトからの選択に加え、
 * 「+ 新しいプロジェクトを作成する」を選ぶと名前入力欄がインラインで現れ(モーダル不使用)、
 * その場でprojectRepository.createを呼び出して新規プロジェクトを作成・選択できる
 * (D6のプロジェクト管理画面へ事前に作成しに行く手間を無くすためのユーザー要望)。
 * 作成したプロジェクトは既存のDB永続化の仕組みにより精算画面(SettlementScreen)の
 * 選択肢にも自動的に表示される。表示名は既存のプロジェクト管理画面(D6)と同じ
 * 「プロジェクト」に統一し、「割勘バッチ」という独自の呼称は使わない(人間レビューでの
 * 指摘、同一エンティティが画面によって別名で呼ばれる不整合の解消)。
 */
function ProjectQuickAddSelect({ id, label, value, projects, onChange, onCreate }: ProjectQuickAddSelectProps) {
  const { t } = useTranslation('expenseSplitting')
  const [adding, setAdding] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(): Promise<void> {
    const trimmedName = nameInput.trim()
    if (trimmedName === '') return
    setCreating(true)
    setError(null)
    try {
      const created = await onCreate(trimmedName)
      onChange(created.id)
      setAdding(false)
      setNameInput('')
    } catch {
      setError(t('newProjectError'))
    } finally {
      setCreating(false)
    }
  }

  if (adding) {
    return (
      <div className="expense-splitting-project-quick-add">
        <label htmlFor={`${id}-new-name`}>{t('newProjectNameLabel')}</label>
        <input
          id={`${id}-new-name`}
          type="text"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
        />
        <button type="button" disabled={creating || nameInput.trim() === ''} onClick={() => void handleAdd()}>
          {t('addProjectButton')}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false)
            setNameInput('')
          }}
        >
          {t('cancelButton')}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => {
          if (event.target.value === NEW_PROJECT_OPTION_VALUE) {
            setAdding(true)
            return
          }
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }}
      >
        <option value="">{t('unselected')}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
        <option value={NEW_PROJECT_OPTION_VALUE}>{t('addNewProjectOption')}</option>
      </select>
    </div>
  )
}

