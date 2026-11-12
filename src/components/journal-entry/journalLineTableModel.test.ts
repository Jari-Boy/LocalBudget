/**
 * 仕訳一覧の「明細行単位」の表(計画Issue #182)で使う純粋関数 pairLinesBySide のユニットテスト。
 * 仕訳の明細行を借方・貸方に分け、行番号で対応づけた「表の行」の並びにする処理を検証する。
 * 複合仕訳(片側が3行以上)で足りない側が null(空欄)になること、各側の並び順が保たれること、
 * 貸借の区分が未設定の行は表に載せないこと、明細が0行でも1行分は返すことを確認する。
 * 外部依存なし(DB・DOMに触れない)。
 */
import { describe, expect, it } from 'vitest'
import { pairLinesBySide } from './journalLineTableModel'

type L = { id: string; side: 'debit' | 'credit' | null }

const d = (id: string): L => ({ id, side: 'debit' })
const c = (id: string): L => ({ id, side: 'credit' })

describe('pairLinesBySide', () => {
  it('借方1行・貸方1行の仕訳は、1行に借方と貸方が並ぶ', () => {
    expect(pairLinesBySide([d('d1'), c('c1')])).toEqual([{ debit: d('d1'), credit: c('c1') }])
  })

  it('借方3行・貸方1行の複合仕訳は3行になり、貸方の足りない行は null になる', () => {
    expect(pairLinesBySide([d('d1'), d('d2'), d('d3'), c('c1')])).toEqual([
      { debit: d('d1'), credit: c('c1') },
      { debit: d('d2'), credit: null },
      { debit: d('d3'), credit: null },
    ])
  })

  it('借方1行・貸方3行の複合仕訳は3行になり、借方の足りない行は null になる', () => {
    expect(pairLinesBySide([d('d1'), c('c1'), c('c2'), c('c3')])).toEqual([
      { debit: d('d1'), credit: c('c1') },
      { debit: null, credit: c('c2') },
      { debit: null, credit: c('c3') },
    ])
  })

  it('各側の並び順は入力順のまま保たれる(借方と貸方が入り交じっていても)', () => {
    const rows = pairLinesBySide([c('c1'), d('d1'), c('c2'), d('d2')])
    expect(rows.map((r) => [r.debit?.id, r.credit?.id])).toEqual([
      ['d1', 'c1'],
      ['d2', 'c2'],
    ])
  })

  it('貸借の区分が未設定(null)の行は表に載せない', () => {
    const rows = pairLinesBySide([d('d1'), { id: 'x', side: null }, c('c1')])
    expect(rows).toEqual([{ debit: d('d1'), credit: c('c1') }])
  })

  it('明細が0行でも、空欄の1行を返す(編集中の新規行のため)', () => {
    expect(pairLinesBySide<L>([])).toEqual([{ debit: null, credit: null }])
  })
})
