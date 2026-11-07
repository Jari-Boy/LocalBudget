import type { CreateJournalEntryInput } from '../journal/JournalEntry'

export interface BuildCounterpartyExpenseSplittingJournalEntryInputParams {
  /** 付け替え対象の費用科目(元仕訳と同じ科目)のid */
  expenseAccountId: number
  /** 立替金(資産)科目のid */
  advanceAssetAccountId: number
  /** 支出を立て替えた世帯メンバーのhousehold_member_id */
  payerMemberId: number
  /** 精算待ちの相手(世帯外)のcounterparty_id */
  counterpartyId: number
  /** 精算バッチのid(計画Issue #133、settlement_batches)。立替金行に付与する */
  settlementBatchId: number
  /** 元仕訳の行のproject_id(イベント)。費用行に引き継ぐ(計画Issue #133) */
  eventProjectId?: number | null
  amount: number
  entryDate: string
  memo?: string | null
}

/**
 * 世帯外の相手との割勘仕訳(docs/domain/expense-splitting.md 1.4節)を生成する純粋関数。
 * 相手側の負債は家計簿の管理範囲外のため、立替金の資産側のみを使い、費用側の行に
 * counterparty_idを付与する2行仕訳を組み立てる。household_member_id間の負債側立替金
 * (buildHouseholdMemberExpenseSplittingJournalEntryInputのadvanceLiabilityAccountId相当)は
 * 発生しない。JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInput
 * (source_typeは'expense_splitting'、計画Issue #149)を返す。科目id・counterparty_id・settlementBatchIdの
 * 解決は呼び出し側の責務。
 *
 * 立替金(資産)行は`settlementBatchId`(計画Issue #133、精算バッチのタグ)を持ち、費用行は
 * `eventProjectId`(元仕訳のproject_id、イベントのタグ)を引き継ぐ。2つのタグは独立した
 * カラムであり、どちらも同じ仕訳の異なる行に同時に存在できる(イベント別PLが割勘の友人
 * 負担分で過大になるバグの解消)。
 *
 * 元仕訳との関連付け(journal_entry_links、計画Issue #132)は計画Issue #138で廃止され、
 * 関連仕訳グループ(JournalEntryLinkGroupRepository)による表示専用のグルーピングに
 * 置き換わった。グループへの参加は呼び出し側(作成後にjoinOrCreateGroupsを呼ぶ)の責務。
 * 起票者(CreateJournalEntryInput.householdMemberId)はpayerMemberId(立て替えた世帯メンバー、
 * 割勘を起票した側)を使う(計画Issue #88)。
 */
export function buildCounterpartyExpenseSplittingJournalEntryInput(
  params: BuildCounterpartyExpenseSplittingJournalEntryInputParams,
): CreateJournalEntryInput {
  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    householdMemberId: params.payerMemberId,
    sourceType: 'expense_splitting',
    lines: [
      {
        accountId: params.advanceAssetAccountId,
        householdMemberId: params.payerMemberId,
        settlementBatchId: params.settlementBatchId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.payerMemberId,
        counterpartyId: params.counterpartyId,
        projectId: params.eventProjectId ?? null,
        side: 'credit',
        amount: params.amount,
      },
    ],
  }
}
