/**
 * 仕訳一覧の明細行単位の表と割勘の候補表の、列見出しでの並び替えの値の取り方(計画Issue #302)。並び替えの仕組み
 * (昇順→降順→解除、押した時点の値で固定、未設定は最後)は common/table-sort/tableSort が持ち、ここは「仕訳の列ごとの値」だけを決める。
 * 並び替えの単位は仕訳(同じ仕訳の借方・貸方の行は分断しない)。日付・出どころ・摘要・コメントは仕訳の値。
 * 借方・貸方の列(科目・プロジェクト・取引先/精算バッチ・世帯メンバー・金額)は、複合仕訳(片側が複数行)でも、
 * その側の先頭の明細行(表の1行目に出る行)の値で比べる。その側の行が無い・値が空の仕訳は未設定として最後に置く。DB・DOM非依存。
 */
import type { JournalEntry, JournalLine, JournalLineSide } from '../../domain/journal/JournalEntry'
import { resolveSourceTag } from '../common/journal-result/journalResultModel'
import { compareByTableSort, cycleTableSort, textSortValue, type SortValue, type TableSort } from '../common/table-sort/tableSort'

/** 側ごとの列(借方・貸方で同じ種類の列がある) */
export type JournalSideSortColumn = 'account' | 'project' | 'partner' | 'member' | 'amount'

/** 並び替えできる列。チェックの列は対象にしない */
export type JournalSortKey = 'date' | 'source' | 'memo' | 'comment' | `${JournalLineSide}-${JournalSideSortColumn}`

export type JournalSort = TableSort<JournalSortKey>

/** 並び替えの値に使う名前の解決(ID → 表示名)。表に出る名前と同じものを使う。該当がなければ空文字を返す */
export interface JournalSortLookup {
  accountName: (id: number) => string
  projectName: (id: number) => string
  counterpartyName: (id: number) => string
  batchName: (id: number) => string
  memberName: (id: number) => string
}

function sideValue(line: JournalLine | undefined, column: JournalSideSortColumn, lookup: JournalSortLookup): SortValue {
  if (line === undefined) return null
  switch (column) {
    case 'account':
      return textSortValue(lookup.accountName(line.accountId))
    case 'project':
      return line.projectId === null ? null : textSortValue(lookup.projectName(line.projectId))
    case 'partner':
      // 取引先と精算バッチは同じ行に両方付かないため、付いている方を使う(表の「取引先・精算バッチ」列と同じ)
      if (line.counterpartyId !== null) return textSortValue(lookup.counterpartyName(line.counterpartyId))
      if (line.settlementBatchId !== null) return textSortValue(lookup.batchName(line.settlementBatchId))
      return null
    case 'member':
      return textSortValue(lookup.memberName(line.householdMemberId))
    case 'amount':
      return line.amount
  }
}

/** 仕訳の、ある列の並び替えの値 */
export function journalSortValue(key: JournalSortKey, entry: JournalEntry, lookup: JournalSortLookup): SortValue {
  switch (key) {
    case 'date':
      return textSortValue(entry.entryDate)
    case 'source':
      return textSortValue(resolveSourceTag(entry.sourceType, entry.financialInstitutionName).label)
    case 'memo':
      return textSortValue(entry.memo ?? '')
    case 'comment':
      return textSortValue(entry.comment ?? '')
    default: {
      const [side, column] = key.split('-') as [JournalLineSide, JournalSideSortColumn]
      return sideValue(
        entry.lines.find((l) => l.side === side),
        column,
        lookup,
      )
    }
  }
}

/**
 * 見出しを押したときの次の状態。entriesは押した時点の並べる対象(描画中の1ページ分)で、並び替えの値をここで確定する。
 * 以後、編集で値が変わっても並びは動かない。
 */
export function cycleJournalSort(
  current: JournalSort | null,
  key: JournalSortKey,
  entries: readonly JournalEntry[],
  lookup: JournalSortLookup,
): JournalSort | null {
  return cycleTableSort(current, key, entries, (k, entry) => journalSortValue(k, entry, lookup), (entry) => entry.id)
}

/** 2つの仕訳の比較(仕訳のid)。並び替えが無い・値が同じなら0を返すので、呼び出し側が元の順(日付の新しい順)で決める */
export function compareJournalSort(sort: JournalSort | null, a: number, b: number): number {
  return compareByTableSort(sort, a, b)
}
