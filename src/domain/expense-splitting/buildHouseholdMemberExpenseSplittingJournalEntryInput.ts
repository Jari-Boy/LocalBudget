import type { CreateJournalEntryInput } from '../journal/JournalEntry'

export interface BuildHouseholdMemberExpenseSplittingJournalEntryInputParams {
  /** 付け替え対象の費用科目(元仕訳と同じ科目)のid */
  expenseAccountId: number
  /** 立替金(資産)科目のid */
  advanceAssetAccountId: number
  /** 立替金(負債)科目のid */
  advanceLiabilityAccountId: number
  /** 元々の支出者(債権者になる側)のhousehold_member_id */
  fromMemberId: number
  /** 付け替え先(債務者になる側)のhousehold_member_id */
  toMemberId: number
  /** 精算バッチのid(計画Issue #133、settlement_batches)。立替金の資産/負債両行に付与する */
  settlementBatchId: number
  /** 元仕訳の行のproject_id(イベント)。費用付け替え2行に引き継ぐ(計画Issue #133) */
  eventProjectId?: number | null
  amount: number
  entryDate: string
  memo?: string | null
}

/**
 * 世帯メンバー間の割勘仕訳(docs/domain/expense-splitting.md 1.3節)を生成する純粋関数。
 * 「費用をfromMemberからtoMemberへ付け替える」行と「立替金の資産側(fromMember)・負債側
 * (toMember)を発生させる」行の2組4行から成る単一の仕訳を組み立て、
 * JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInput
 * (source_typeは'expense_splitting'、計画Issue #149)を返す。科目id・household_member_id・settlementBatchIdの
 * 解決は呼び出し側の責務(buildBalanceAdjustmentJournalEntryInputと同じパターン)。
 *
 * 立替金(資産/負債)行は`settlementBatchId`(計画Issue #133、精算バッチのタグ)を持ち、
 * 費用付け替え2行は`eventProjectId`(元仕訳のproject_id、イベントのタグ)を引き継ぐ。
 * 2つのタグは独立したカラムであり、どちらも同じ仕訳の異なる行に同時に存在できる
 * (イベント別PLが割勘の友人負担分で過大になるバグの解消)。
 *
 * 元仕訳との関連付け(journal_entry_links、計画Issue #132)は計画Issue #138で廃止され、
 * 関連仕訳グループ(JournalEntryLinkGroupRepository)による表示専用のグルーピングに
 * 置き換わった。グループへの参加は呼び出し側(作成後にjoinOrCreateGroupsを呼ぶ)の責務。
 * 起票者(CreateJournalEntryInput.householdMemberId)はfromMemberId
 * (元々の支出者、割勘を起票した側)を使う(計画Issue #88)。
 */
export function buildHouseholdMemberExpenseSplittingJournalEntryInput(
  params: BuildHouseholdMemberExpenseSplittingJournalEntryInputParams,
): CreateJournalEntryInput {
  const eventProjectId = params.eventProjectId ?? null
  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    householdMemberId: params.fromMemberId,
    sourceType: 'expense_splitting',
    lines: [
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.toMemberId,
        projectId: eventProjectId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.advanceAssetAccountId,
        householdMemberId: params.fromMemberId,
        settlementBatchId: params.settlementBatchId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.fromMemberId,
        projectId: eventProjectId,
        side: 'credit',
        amount: params.amount,
      },
      {
        accountId: params.advanceLiabilityAccountId,
        householdMemberId: params.toMemberId,
        settlementBatchId: params.settlementBatchId,
        side: 'credit',
        amount: params.amount,
      },
    ],
  }
}
