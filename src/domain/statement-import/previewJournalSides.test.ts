/**
 * previewJournalSides(マッピング編集のプレビューで、取込先の科目が仕訳の借方・貸方のどちらに
 * 入るかを決める純粋関数、計画Issue #192)のユニットテスト。
 * 金額の符号(正 = 科目の残高が増える、docs/domain/statement-import.md 1.2)と科目の種別から、
 * 科目側が借方か貸方か、金額の絶対値を返すことを確認する。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { previewJournalSides } from './previewJournalSides'

describe('previewJournalSides', () => {
  it('資産の科目は、金額がプラスなら借方・マイナスなら貸方に入る', () => {
    expect(previewJournalSides(3200, 'asset')).toEqual({ accountSide: 'debit', amount: 3200 })
    expect(previewJournalSides(-3200, 'asset')).toEqual({ accountSide: 'credit', amount: 3200 })
  })

  it('負債の科目(クレジットカード)は、金額がプラスなら貸方・マイナスなら借方に入る', () => {
    expect(previewJournalSides(3200, 'liability')).toEqual({ accountSide: 'credit', amount: 3200 })
    expect(previewJournalSides(-3200, 'liability')).toEqual({ accountSide: 'debit', amount: 3200 })
  })

  it('費用は資産と、収益・純資産は負債と同じ向きになる(残高が増える側に入る)', () => {
    expect(previewJournalSides(100, 'expense').accountSide).toBe('debit')
    expect(previewJournalSides(100, 'revenue').accountSide).toBe('credit')
    expect(previewJournalSides(100, 'equity').accountSide).toBe('credit')
  })

  it('金額0は借方・貸方を分けず金額0として扱う(資産ならプラス側=借方)', () => {
    expect(previewJournalSides(0, 'asset')).toEqual({ accountSide: 'debit', amount: 0 })
  })
})
