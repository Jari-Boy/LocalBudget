/**
 * previewJournalCells(マッピング編集のプレビューの、借方・貸方の欄に出す「科目名 金額」の文字列、
 * 計画Issue #192)のユニットテスト。取込先の科目が借方・貸方のどちらに入るかは
 * previewJournalSides に従い、反対側には相手科目として「任意の科目」(渡した文言)を同じ金額で出す。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { previewJournalCells } from './previewJournalCells'

const ANY = '任意の科目'

describe('previewJournalCells', () => {
  it('資産の科目でプラスなら、借方に「科目名 金額」、貸方に任意の科目が入る', () => {
    expect(previewJournalCells(3200, { name: '普通預金', category: 'asset' }, ANY)).toEqual({
      debit: '普通預金 ¥3,200',
      credit: '任意の科目 ¥3,200',
    })
  })

  it('資産の科目でマイナスなら、金額は絶対値で貸方に科目が入る', () => {
    expect(previewJournalCells(-50000, { name: '普通預金', category: 'asset' }, ANY)).toEqual({
      debit: '任意の科目 ¥50,000',
      credit: '普通預金 ¥50,000',
    })
  })

  it('負債(クレジットカード)でプラスなら、貸方に科目が入る', () => {
    expect(previewJournalCells(3200, { name: '楽天VISA', category: 'liability' }, ANY)).toEqual({
      debit: '任意の科目 ¥3,200',
      credit: '楽天VISA ¥3,200',
    })
  })
})
