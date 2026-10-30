import type { CreateJournalEntryInput } from '../journal/JournalEntry'

export interface BuildHouseholdMemberExpenseSplittingJournalEntryInputParams {
  /** 按分対象の元の支出仕訳(食費等)の費用行のid。allocatesリンクのto_lineとなる */
  originalLineId: number
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
  /** 割勘バッチを表すproject_id(kind = 'settlement') */
  projectId: number
  amount: number
  entryDate: string
  memo?: string | null
}

/**
 * 世帯メンバー間の割勘仕訳(docs/domain/expense-splitting.md 1.3節)を生成する純粋関数。
 * 「費用をfromMemberからtoMemberへ付け替える」行と「立替金の資産側(fromMember)・負債側
 * (toMember)を発生させる」行の2組4行から成る単一の仕訳を組み立て、
 * JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInput
 * (source_typeは既定の'manual'のまま)を返す。科目id・household_member_id・project_idの
 * 解決は呼び出し側の責務(buildBalanceAdjustmentJournalEntryInputと同じパターン)。
 *
 * 返り値のlinksに、割勘仕訳の費用の貸方行(from_line)から元仕訳の費用行(to_line)への
 * allocatesリンクを含めることで、割勘仕訳自体の作成とallocatesリンクの作成を単一のDB
 * トランザクションにする(docs/domain/journal.md 1.8の「settlesリンクは消込仕訳自体の作成と
 * 同一トランザクションで書き込まれる」と同じパターンをallocatesにも適用、計画Issue #132で
 * 明細行単位に変更)。起票者(CreateJournalEntryInput.householdMemberId)はfromMemberId
 * (元々の支出者、割勘を起票した側)を使う(計画Issue #88)。
 */
export function buildHouseholdMemberExpenseSplittingJournalEntryInput(
  params: BuildHouseholdMemberExpenseSplittingJournalEntryInputParams,
): CreateJournalEntryInput {
  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    householdMemberId: params.fromMemberId,
    lines: [
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.toMemberId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.advanceAssetAccountId,
        householdMemberId: params.fromMemberId,
        projectId: params.projectId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.fromMemberId,
        side: 'credit',
        amount: params.amount,
      },
      {
        accountId: params.advanceLiabilityAccountId,
        householdMemberId: params.toMemberId,
        projectId: params.projectId,
        side: 'credit',
        amount: params.amount,
      },
    ],
    // from_lineは費用を元の支出者に戻す貸方行(lines[2])。元の費用行(to_line)と科目が一致し貸借が逆になる
    links: [{ fromLineIndex: 2, toLineId: params.originalLineId, linkType: 'allocates', amount: params.amount }],
  }
}
