import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { JournalEntryLinkTarget } from '../journal/JournalEntryLink'

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
 * allocatesリンクは明細行単位(計画Issue #132)で、各inputのfrom_line(fromLineIndex)がその
 * input内の位置を指すため、結合後の配列での位置になるようinputごとの行数分だけずらして
 * そのまま引き継ぐ。リンクは分担者・元仕訳の組ごとに別の費用行(from_line)から出るので、
 * 以前のように元仕訳単位で金額を合算して1本にまとめる必要はない(同じ元仕訳の費用行に
 * 向かうリンクが複数あっても、to_lineごとの割勘額はリンクのamountの合計で求まる)。
 *
 * entryDate・memo・householdMemberIdはinputs内の値(各分担者の按分計算時点のもの)を使わず、
 * 呼び出し側が指定する値で統一する(1件の仕訳としてまとめる以上、複数の値を持てないため)。
 */
export function mergeExpenseSplittingJournalEntryInputs(
  params: MergeExpenseSplittingJournalEntryInputsParams,
): CreateJournalEntryInput {
  const links: JournalEntryLinkTarget[] = []
  let lineOffset = 0
  for (const input of params.inputs) {
    for (const link of input.links ?? []) {
      links.push({ ...link, fromLineIndex: link.fromLineIndex + lineOffset })
    }
    lineOffset += input.lines.length
  }

  return {
    entryDate: params.entryDate,
    memo: params.memo,
    householdMemberId: params.householdMemberId,
    lines: params.inputs.flatMap((input) => input.lines),
    links,
  }
}
