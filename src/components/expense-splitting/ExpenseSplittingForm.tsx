import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { CreateJournalEntryInput, JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import {
  buildExpenseSplittingJournalEntryInputs,
  type ExpenseSplitRecipient,
} from '../../domain/expense-splitting/buildExpenseSplittingJournalEntryInputs'
import { findDebitExpenseLines } from '../../domain/expense-splitting/checkExpenseSplittability'
import { mergeExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/mergeExpenseSplittingJournalEntryInputs'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { CounterpartyQuickAddSelect } from '../counterparty-management/CounterpartyQuickAddSelect'
import {
  calculateParticipantAmounts,
  splitRecipientsAcrossLines,
  toExpenseSplitRecipients,
  toExpenseSplitRecipientsForEntryAmount,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'
import './ExpenseSplittingForm.css'

/**
 * 精算バッチセレクトの「新しい精算バッチを作成する」を表す特殊値(既定選択、ユーザーからの
 * 指摘「プロジェクトを選択する必要はないのでは」への対応)。バッチidと衝突しない文字列を使う。
 */
const NEW_SETTLEMENT_BATCH_VALUE = '__new__'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface SettlementBatchFinder {
  findAll(): SettlementBatch[] | Promise<SettlementBatch[]>
}
interface SettlementBatchCreator {
  create(input: {
    name: string
    type: SettlementBatch['type']
    counterpartyId?: number | null
  }): SettlementBatch | Promise<SettlementBatch>
}
interface SettlementBatchUpdater {
  update(id: number, input: { counterpartyId?: number | null }): SettlementBatch | Promise<SettlementBatch>
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
interface JournalEntryLinkGroupJoiner {
  joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void | Promise<void>
}

export interface ExpenseSplittingFormProps {
  /**
   * 割勘対象として選択済みの元の支出仕訳(1件以上)。複数選択時は、分担者設定
   * (相手・配分方法)を共通のまま、元仕訳ごとに独立した割勘仕訳をまとめて作成する
   * (計画Issue #40、人間レビューでの再指摘への対応)。
   */
  originalEntries: JournalEntry[]
  accountRepository: AccountFinder
  settlementBatchRepository: SettlementBatchFinder & SettlementBatchCreator & SettlementBatchUpdater
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder & CounterpartyCreator
  journalEntryRepository: JournalEntryCreator
  journalEntryLinkGroupRepository: JournalEntryLinkGroupJoiner
  onComplete: (createdEntries: JournalEntry[]) => void
  onBack: () => void
  /** 割勘仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  accounts: Account[]
  settlementBatches: SettlementBatch[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

/** 明細行の金額の合計(費用の行が複数ある仕訳の按分対象額に使う) */
function sumAmounts(lines: readonly JournalLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0)
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
 * 仕訳(分担者数×選択した元仕訳数)を、分担者(人)単位でグルーピングした上で
 * mergeExpenseSplittingJournalEntryInputsに渡し、分担者ごとに1件の複合仕訳へ統合して
 * から作成する(人間レビューでの指摘「割勘の仕訳を作るときは複数明細をまとめて一本で
 * 仕訳を切るように(逆仕訳が切りやすくなるから)」への対応、計画Issue #40)。統合の単位を
 * 「分担者ごと」に限定しているのは、異なる分担者の立替金(負債)行を同じ仕訳に混在させると
 * 精算画面がタグ(account・project・household_member)ごとに残高を区別できなくなる不具合が
 * 見つかったため(evaluatorレビュー指摘、handleSubmit内のJSDoc参照)。1.3・1.4節の2者間
 * 仕訳パターン自体は変更しない。
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
  settlementBatchRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  onComplete,
  onBack,
  today,
}: ExpenseSplittingFormProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const isBatch = originalEntries.length > 1

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [settlementBatchId, setSettlementBatchId] = useState<number | typeof NEW_SETTLEMENT_BATCH_VALUE>(
    NEW_SETTLEMENT_BATCH_VALUE,
  )
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
      Promise.resolve(settlementBatchRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([accounts, settlementBatches, householdMembers, counterparties]) => {
      if (originalEntries.length === 1) {
        // 費用の行が複数ある仕訳は、借方の費用の行の合計を既定値にする(計画Issue #149)
        const expenseLines = findDebitExpenseLines(originalEntries[0], accounts)
        setTotalAmountInput(expenseLines.length > 0 ? String(sumAmounts(expenseLines)) : '')
      }
      setMasterData({ accounts, settlementBatches, householdMembers, counterparties })
    })
    return <p role="status">{tCommon('loading')}</p>
  }

  // 以降のネストした関数(handleCalculate/handleSubmit)からmasterDataを参照すると、TSの
  // narrowingがクロージャ境界を越えて効かず"possibly null"エラーになるため、ここで
  // 非nullであることが確定した参照をローカル変数へ退避しておく。
  const accounts = masterData.accounts
  const settlementBatches = masterData.settlementBatches
  /**
   * 立替金(資産/負債)科目はユーザーに選択させず、seedAdvanceAccounts(db.worker.ts、
   * docs/domain/expense-splitting.md 1.2節)が投入したis_system_managed科目を自動解決する。
   * 通常のUI操作ではWorker起動時に必ず投入済みのため常に見つかるが、投入前のテストDB等では
   * 見つからない場合があり、その場合はnullのままhandleSubmitでエラーとする。
   */
  const advanceAssetAccountId = accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId =
    accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
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
      // 費用の行が複数ある仕訳は、各行を同じ割合で割る(計画Issue #149)
      for (const expenseLine of findDebitExpenseLines(entry, accounts)) {
        const amounts = calculateParticipantAmounts(expenseLine.amount, participants, allocationMode)
        for (const [key, amount] of amounts) {
          totals.set(key, (totals.get(key) ?? 0) + amount)
        }
      }
    }
    setParticipants((prev) => prev.map((row) => ({ ...row, amountInput: String(totals.get(String(row.key)) ?? 0) })))
  }

  async function handleSubmit() {
    if (submitting) return
    /**
     * バリデーションより前、精算バッチ作成(await)より前の時点で同期的に無効化する。
     * 精算バッチの新規作成(resolvedSettlementBatchId解決)がhandleSubmit内の最初のawaitに
     * なったため、ここより後で無効化すると、連続クリック(二重送信)時に無効化が間に合わず
     * 精算バッチ・仕訳が重複して作成される不具合が実機レビューで見つかったため、冒頭で
     * 同期的に無効化する(以降の全ての分岐はtry/finallyでsetSubmitting(false)に戻す)。
     */
    setSubmitting(true)
    setError(null)

    try {
      const entryLines: { entry: JournalEntry; expenseLines: JournalLine[] }[] = []
      for (const entry of originalEntries) {
        const expenseLines = findDebitExpenseLines(entry, accounts)
        if (expenseLines.length === 0) {
          setError(t('expenseAccountNotFoundError'))
          return
        }
        entryLines.push({ entry, expenseLines })
      }

      if (advanceAssetAccountId === null) {
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

      /**
       * 世帯外の相手を含む割勘の場合、バッチにcounterparty_idを設定する(計画Issue #133)。
       * 複数の世帯外相手が混在する場合は先頭の1件を採用する(精算画面の「対象者」フィルターでの
       * 絞り込みという補助的な用途のための簡易な扱い、懸念点として既知)。
       */
      const firstCounterpartyId = counterpartyRows.find((row) => row.targetId !== null)?.targetId ?? null

      /**
       * 精算バッチの選択UIは「既存バッチから選ぶ」か「新しい精算バッチを作成する」(既定選択)の
       * 2択のみで、名前入力フォームは持たない(ユーザーからの指摘「精算バッチの名前はこの画面の
       * 摘要がそのまま使えるのでは」への対応)。新規作成を選んだ状態のまま確定された場合、ここで
       * 初めてこの時点の摘要(memoInput)を名前としてバッチを作成する。参加者確定後のこのタイミングで
       * 作成するため、counterparty_idも作成時に直接設定でき、既存バッチの場合のような事後update
       * 呼び出しは不要。
       */
      let resolvedSettlementBatchId: number
      if (settlementBatchId === NEW_SETTLEMENT_BATCH_VALUE) {
        const created = await settlementBatchRepository.create({
          name: memoInput.trim(),
          type: 'expense_splitting',
          counterpartyId: firstCounterpartyId,
        })
        resolvedSettlementBatchId = created.id
      } else {
        resolvedSettlementBatchId = settlementBatchId
        const currentBatch = settlementBatches.find((batch) => batch.id === settlementBatchId)
        if (firstCounterpartyId !== null && currentBatch?.counterpartyId == null) {
          await settlementBatchRepository.update(settlementBatchId, { counterpartyId: firstCounterpartyId })
        }
      }

      const entryDate = today ?? new Date().toISOString().slice(0, 10)
      /**
       * 分担者(recipient)ごとに、その分担者が絡む全ての元仕訳分の入力をまとめて保持する。
       * 「分担者ごとに1件の複合仕訳にまとめ、選択した元仕訳が複数ある場合はその分も同じ
       * 分担者の仕訳にまとめる」という設計(下記mergeExpenseSplittingJournalEntryInputsの
       * JSDoc・docs/decisions.md(2026-09-06)参照)のためのグルーピング。
       */
      const inputsByRecipientKey = new Map<string, CreateJournalEntryInput[]>()
      for (const { entry, expenseLines } of entryLines) {
        /**
         * 費用の行が複数ある仕訳は、各行を同じ割合で割る(計画Issue #149)。複数の元仕訳を
         * まとめて割勘する場合は行ごとに按分額を計算し、単一の元仕訳の場合はプレビュー欄の
         * 分担額(手動編集を含む)を行の金額比で配分する(合計は1円もずれない)。
         */
        const recipientsPerLine: ExpenseSplitRecipient[][] = isBatch
          ? expenseLines.map((expenseLine) =>
              toExpenseSplitRecipientsForEntryAmount(
                participants,
                advanceLiabilityAccountId,
                expenseLine.amount,
                allocationMode,
              ),
            )
          : splitRecipientsAcrossLines(
              toExpenseSplitRecipients(participants, advanceLiabilityAccountId),
              expenseLines.map((expenseLine) => expenseLine.amount),
            )
        if (recipientsPerLine.every((recipients) => recipients.length === 0)) {
          setError(t('noRecipientError'))
          return
        }
        expenseLines.forEach((expenseLine, lineIndex) => {
          const recipients = recipientsPerLine[lineIndex]
          if (recipients.length === 0) return
          const inputs = buildExpenseSplittingJournalEntryInputs({
            expenseAccountId: expenseLine.accountId,
            advanceAssetAccountId,
            fromMemberId: entry.householdMemberId,
            settlementBatchId: resolvedSettlementBatchId,
            eventProjectId: expenseLine.projectId,
            entryDate,
            recipients,
          })
          recipients.forEach((recipient, index) => {
            const key = recipient.kind === 'householdMember' ? `householdMember:${recipient.toMemberId}` : `counterparty:${recipient.counterpartyId}`
            const existing = inputsByRecipientKey.get(key) ?? []
            existing.push(inputs[index])
            inputsByRecipientKey.set(key, existing)
          })
        })
      }

      /**
       * 分担者ごとに、その分担者分のCreateJournalEntryInput(選択した元仕訳の件数分)を
       * mergeExpenseSplittingJournalEntryInputsで1件の複合仕訳へ統合する(人間レビューでの
       * 指摘「割勘の仕訳を作るときは複数明細をまとめて一本で仕訳を切るように(逆仕訳が
       * 切りやすくなるから)」への対応、計画Issue #40)。統合の単位を「分担者ごと」に
       * 限定しているのは、異なる分担者(household_member_id)の立替金(負債)行を同じ仕訳に
       * 混在させると、精算画面がタグ(account・project・household_member)ごとに残高を
       * 区別できず、ある世帯メンバーの精算操作で無関係な別の世帯メンバーの債務まで無警告で
       * 消し込まれてしまう不具合が実際に見つかったため(evaluatorレビュー指摘、docs/domain/
       * settlement.md 1.7の「タグの組み合わせごとに消込対象を一意に特定できる」という
       * 既存の不変条件に反する状態を作ってしまっていた)。分担者が同じであれば、選択した
       * 元仕訳が複数あっても常に同じ人物への同じ債務の一部であり、タグの混在は起こらない。
       * 摘要はmemoInput(既定値はcomputeDefaultMemo、ユーザーが自由に編集できる)を全ての
       * 仕訳で共通して使い、空欄のまま確定した場合はnull(無題)とする。起票者は選択した
       * 元仕訳のうち先頭のもののhouseholdMemberIdを使う(全行に明示的なhousehold_member_id
       * が設定されるため、実効メンバーの解決においてこの値がフォールバックとして参照される
       * ことはない)。
       */
      const mergedInputs = [...inputsByRecipientKey.values()].map((inputs) =>
        mergeExpenseSplittingJournalEntryInputs({
          inputs,
          entryDate,
          memo: memoInput.trim() === '' ? null : memoInput,
          householdMemberId: originalEntries[0].householdMemberId,
        }),
      )

      const created: JournalEntry[] = []
      for (const mergedInput of mergedInputs) {
        const createdEntry = await journalEntryRepository.create(mergedInput)
        created.push(createdEntry)
        /**
         * 割勘仕訳の作成と同時に、元仕訳(originalEntries)と同じ関連仕訳グループへ所属させる
         * (計画Issue #138、journal_entry_linksのallocatesリンクが担っていた「関連仕訳の
         * 一覧表示」の役割の置き換え)。anchorを元仕訳側にすることで、元仕訳が既に(別の割勘
         * 操作等で)グループに所属していればそのグループへ合流し、未所属なら新規グループを
         * 作成する(JournalEntryLinkGroupRepository.joinOrCreateGroups参照)。
         */
        await journalEntryLinkGroupRepository.joinOrCreateGroups(
          originalEntries.map((entry) => entry.id),
          [createdEntry.id],
        )
      }
      onComplete(created)
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
          const expenseLines = findDebitExpenseLines(entry, accounts)
          return (
            <li key={entry.id}>
              <span>{entry.entryDate}</span>
              <span>{entry.memo ?? t('entryNoMemo')}</span>
              {expenseLines.length > 0 && <span>{formatCurrency(sumAmounts(expenseLines), 'JPY')}</span>}
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

      <SettlementBatchSelect
        id="expense-splitting-settlement-batch"
        label={t('settlementBatchLabel')}
        value={settlementBatchId}
        settlementBatches={masterData.settlementBatches}
        onChange={setSettlementBatchId}
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

interface SettlementBatchSelectProps {
  id: string
  label: string
  value: number | typeof NEW_SETTLEMENT_BATCH_VALUE
  settlementBatches: readonly SettlementBatch[]
  onChange: (settlementBatchId: number | typeof NEW_SETTLEMENT_BATCH_VALUE) => void
}

/**
 * 精算バッチ(type='expense_splitting')セレクト(計画Issue #40、計画Issue #133でproject
 * (kind='settlement')からsettlement_batchesへ置き換え)。既存バッチからの選択肢に加え、
 * 「新しい精算バッチを作成する」を既定選択として持つ(ユーザーからの指摘「プロジェクトを
 * 選択する必要はないのでは」「精算バッチの名前はこの画面の摘要がそのまま使えるのでは」への
 * 対応)。新規作成時に名前を別途入力させる作成フロー自体を廃止しており、実際の作成は
 * handleSubmit側が確定時の摘要を名前として行う(このコンポーネントはバッチidの選択状態のみを
 * 持つ)。同じ相手との割勘を複数回に分けて同一バッチにまとめたい場合のために、既存バッチへの
 * 選択も維持する。
 */
function SettlementBatchSelect({ id, label, value, settlementBatches, onChange }: SettlementBatchSelectProps) {
  const { t } = useTranslation('expenseSplitting')

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) =>
          onChange(event.target.value === NEW_SETTLEMENT_BATCH_VALUE ? NEW_SETTLEMENT_BATCH_VALUE : Number(event.target.value))
        }
      >
        {settlementBatches.map((batch) => (
          <option key={batch.id} value={batch.id}>
            {batch.name}
          </option>
        ))}
        <option value={NEW_SETTLEMENT_BATCH_VALUE}>{t('addNewSettlementBatchOption')}</option>
      </select>
    </div>
  )
}

