import type { CreateJournalEntryInput } from '../journal/JournalEntry'

type Line = CreateJournalEntryInput['lines'][number]

const lineKey = (l: Line) =>
  [l.accountId, l.side, l.projectId ?? '', l.householdMemberId ?? '', l.counterpartyId ?? '', l.settlementBatchId ?? ''].join(':')

/** 科目・貸借・プロジェクト・世帯メンバー・取引先・精算バッチが同じ行を1行にまとめて、金額を合計する。立替金・未払金の行を先頭にする */
function sumSameLines(lines: readonly Line[]): Line[] {
  const summed = new Map<string, Line>()
  for (const line of lines) {
    const key = lineKey(line)
    const existing = summed.get(key)
    summed.set(key, existing === undefined ? { ...line } : { ...existing, amount: existing.amount + line.amount })
  }
  // 精算バッチが付いた行(立替金・未払金)を先頭にまとめる。元の並びは保つ(貸借を分けて見ても先頭に来る)
  const all = [...summed.values()]
  const tagged = (l: Line) => l.settlementBatchId !== null && l.settlementBatchId !== undefined
  return [...all.filter(tagged), ...all.filter((l) => !tagged(l))]
}

export interface MergeExpenseSplittingJournalEntryInputsParams {
  /**
   * buildHouseholdMemberExpenseSplittingJournalEntryInput/
   * buildCounterpartyExpenseSplittingJournalEntryInputが分担者ごとに個別に組み立てた
   * CreateJournalEntryInput。
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
 * 明細行(lines)は全inputsのlinesを結合し、科目・貸借・プロジェクト・世帯メンバー・取引先・
 * 精算バッチがすべて同じ行は1行に金額を合計する(同じ相手との複数の支出で、立替金・未払金などが
 * 何行にも分かれないように、計画Issue #153の実機確認での指摘)。1.3・1.4節の2者間仕訳パターン自体
 * (各行のaccount_id・household_member_id・counterparty_id等)は変更しない。
 *
 * entryDate・memo・householdMemberIdはinputs内の値(各分担者の按分計算時点のもの)を使わず、
 * 呼び出し側が指定する値で統一する(1件の仕訳としてまとめる以上、複数の値を持てないため)。
 */
export function mergeExpenseSplittingJournalEntryInputs(
  params: MergeExpenseSplittingJournalEntryInputsParams,
): CreateJournalEntryInput {
  return {
    entryDate: params.entryDate,
    memo: params.memo,
    householdMemberId: params.householdMemberId,
    sourceType: 'expense_splitting',
    lines: sumSameLines(params.inputs.flatMap((input) => input.lines)),
  }
}
