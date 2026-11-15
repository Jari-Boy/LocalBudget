/**
 * resolveStatementAnchors の単体テスト(外部依存なしの純粋関数)。
 *
 * 検証対象: 取り込んだ明細(external_transaction_refs)から、取引後残高を持つ行を基準点に変換する処理
 * (計画Issue #205)。CSVの並び順(昇順/降順)は balance_after[i] = balance_after[i-1] + amount[i] の整合で判定し、
 * 同じ日の複数行は「その日の最後の残高」を採用し、1行目からは取り込み開始直前の残高も基準点にする。
 */
import { describe, expect, it } from 'vitest'
import { resolveStatementAnchors, type StatementAnchorSource } from './resolveStatementAnchors'

function row(id: number, entryDate: string, amount: number, balance: number | null, rowOrder: number | null): StatementAnchorSource {
  return { id, entryDate, amount, externalBalanceAfter: balance, rowOrder, importedAt: '2026-03-01 00:00:00' }
}

describe('resolveStatementAnchors', () => {
  it('昇順のCSVは各日の最後の残高と、取り込み開始直前(1行目の残高-金額、前日)を基準点にする', () => {
    const anchors = resolveStatementAnchors([
      row(1, '2026-01-10', 1000, 11000, 0),
      row(2, '2026-01-11', -500, 10500, 1),
    ])
    expect(anchors).toEqual([
      { date: '2026-01-09', balance: 10000 },
      { date: '2026-01-10', balance: 11000 },
      { date: '2026-01-11', balance: 10500 },
    ])
  })

  it('降順のCSV(最後の行が最も古い)でも整合から並び順を判定して同じ基準点を得る', () => {
    const anchors = resolveStatementAnchors([
      row(1, '2026-01-11', -500, 10500, 0),
      row(2, '2026-01-10', 1000, 11000, 1),
    ])
    expect(anchors).toEqual([
      { date: '2026-01-09', balance: 10000 },
      { date: '2026-01-10', balance: 11000 },
      { date: '2026-01-11', balance: 10500 },
    ])
  })

  it('同じ日に複数行あるときは、時系列で最後の行の残高が(後勝ちで)採用される並びで返す(降順でも)', () => {
    const anchors = resolveStatementAnchors([
      row(1, '2026-01-10', 300, 11300, 0),
      row(2, '2026-01-10', 1000, 11000, 1),
    ])
    expect(anchors.findLast((a) => a.date === '2026-01-10')).toEqual({ date: '2026-01-10', balance: 11300 })
    expect(anchors[0]).toEqual({ date: '2026-01-09', balance: 10000 })
  })

  it('行順が無い既存データはid順で代用する', () => {
    const anchors = resolveStatementAnchors([
      row(1, '2026-01-10', 1000, 11000, null),
      row(2, '2026-01-11', -500, 10500, null),
    ])
    expect(anchors.map((a) => a.balance)).toEqual([10000, 11000, 10500])
  })

  it('取引後残高の無い行は基準点にしない', () => {
    expect(resolveStatementAnchors([row(1, '2026-01-10', 1000, null, 0)])).toEqual([])
  })
})
