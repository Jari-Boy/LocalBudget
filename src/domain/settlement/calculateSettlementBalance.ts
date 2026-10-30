import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'

/**
 * 明細行単位の消込残高の計算(docs/domain/settlement.md 1.6、計画Issue #132)。
 * 消込先の明細行(toLine)の金額から、その明細行をto_lineとするsettlesリンクの金額合計を
 * 差し引く。linksにはJournalEntryRepository.listLinksForEntryの返り値(from/to双方向・
 * allocatesも混在しうる)をそのまま渡せるよう、linkType='settles'かつtoLineId=toLine.idの
 * ものだけを本関数内で絞り込む。リンクが明細行に直接結びつくため、同じ仕訳の別の一時勘定行
 * (別の科目・別の世帯メンバー)への消込が混入することはない。
 */
export function calculateLineSettlementBalance(
  toLine: JournalLine,
  links: readonly JournalEntryLink[],
): number {
  const settledAmount = links
    .filter((link) => link.linkType === 'settles' && link.toLineId === toLine.id)
    .reduce((total, link) => total + link.amount, 0)

  return toLine.amount - settledAmount
}

/**
 * 仕訳が持つ特定の一時勘定科目(settlementAccountId)の消込残高。その科目の明細行それぞれの
 * 消込残高(calculateLineSettlementBalance)を合計する。
 *
 * 消込仕訳自身の一時勘定行(settlesリンクのfrom_lineになっている行)は、消し込まれる側ではなく
 * 消し込む側であるため合計から除く。リンクが明細行に結びつくことで「この行は消込元か」が
 * 構造的に判定でき、タグ(project_id・account_id)一致だけで候補を探した場合に消込仕訳自身が
 * 混入する問題(docs/decisions.md 2026-08-15)を呼び出し側で回避する必要がなくなった。
 */
export function calculateSettlementBalance(
  toEntry: JournalEntry,
  settlementAccountId: number,
  links: readonly JournalEntryLink[],
): number {
  return findSettlementTargetLines(toEntry, settlementAccountId, links).reduce(
    (total, line) => total + calculateLineSettlementBalance(line, links),
    0,
  )
}

/**
 * 仕訳のうち、指定した一時勘定科目の「消し込まれる側」の明細行を返す。
 * settlesリンクのfrom_lineになっている行(消込仕訳自身の行)は除く。
 */
export function findSettlementTargetLines(
  entry: JournalEntry,
  settlementAccountId: number,
  links: readonly JournalEntryLink[],
): JournalLine[] {
  const settlingLineIds = new Set(
    links.filter((link) => link.linkType === 'settles').map((link) => link.fromLineId),
  )
  return entry.lines.filter((line) => line.accountId === settlementAccountId && !settlingLineIds.has(line.id))
}
