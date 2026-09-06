import type { CreateJournalEntryInput } from '../journal/JournalEntry'

export interface MergeExpenseSplittingJournalEntryInputsParams {
  /**
   * buildHouseholdMemberExpenseSplittingJournalEntryInput/
   * buildCounterpartyExpenseSplittingJournalEntryInputが分担者ごとに個別に組み立てた
   * CreateJournalEntryInput。各要素はallocatesリンクを1本ずつ持つ(links参照)。
   */
  inputs: readonly CreateJournalEntryInput[]
  entryDate: string
  memo: string | null
  householdMemberId: number
}

/**
 * 複数の割勘仕訳入力(分担者ごとに個別に組み立てられたCreateJournalEntryInput)を、
 * 1件の複合仕訳へ統合する(計画Issue #40、人間レビューでの指摘「割勘の仕訳を作るときは
 * 複数明細をまとめて一本で仕訳を切るように(逆仕訳が切りやすくなるから)」への対応)。
 *
 * 明細行(lines)は全inputsのlinesをそのまま結合するだけで、1.3・1.4節の2者間仕訳
 * パターン自体(各行のaccount_id・household_member_id・counterparty_id等)は変更しない。
 * allocatesリンクは元仕訳(to_entry_id)ごとに金額を合算して1本にまとめる
 * (docs/domain/journal.md 1.8「1回の割勘バッチが複数の元仕訳をまとめて対象にすることも
 * ある(一対多)」という既存のリンク設計をそのまま活用する。同じ元仕訳に対して分担者ごとに
 * 別々のリンクを残すと、元仕訳の詳細画面から辿った際に同じ割勘バッチの按分額が分散して
 * 見えてしまうため、元仕訳単位で合算する)。
 *
 * entryDate・memo・householdMemberIdはinputs内の値(各分担者の按分計算時点のもの)を使わず、
 * 呼び出し側が指定する値で統一する(1件の仕訳としてまとめる以上、複数の値を持てないため)。
 */
export function mergeExpenseSplittingJournalEntryInputs(
  params: MergeExpenseSplittingJournalEntryInputsParams,
): CreateJournalEntryInput {
  const amountByToEntryId = new Map<number, number>()
  for (const input of params.inputs) {
    for (const link of input.links ?? []) {
      amountByToEntryId.set(link.toEntryId, (amountByToEntryId.get(link.toEntryId) ?? 0) + link.amount)
    }
  }

  return {
    entryDate: params.entryDate,
    memo: params.memo,
    householdMemberId: params.householdMemberId,
    lines: params.inputs.flatMap((input) => input.lines),
    links: [...amountByToEntryId].map(([toEntryId, amount]) => ({
      toEntryId,
      linkType: 'allocates' as const,
      amount,
    })),
  }
}
