/**
 * describeTemplateContent / summarizeTemplateAmount の単体テスト(計画Issue #201)。
 * テンプレート一覧の「内容」(借方の科目 / 貸方の科目)と「金額」(固定・起票時に入力・一部入力)を
 * テンプレートの行から導く純粋関数を検証する。DB・DOM非依存。
 */
import { describe, expect, it } from 'vitest'
import type { JournalTemplate, JournalTemplateLine } from './JournalTemplate'
import { describeTemplateContent, summarizeTemplateAmount } from './describeJournalTemplate'

const line = (
  lineNo: number,
  side: 'debit' | 'credit',
  accountId: number,
  amount: number | null,
): JournalTemplateLine => ({
  lineNo,
  side,
  accountId,
  amount,
  projectId: null,
  householdMemberId: null,
  counterpartyId: null,
  settlementBatchId: null,
})

const template = (lines: JournalTemplateLine[]): JournalTemplate => ({
  id: 1,
  name: 'T',
  memo: null,
  bookkeeperHouseholdMemberId: null,
  groupId: null,
  sortOrder: 0,
  isActive: true,
  lines,
  createdAt: '',
  updatedAt: '',
})

const names = new Map([
  [1, '食費'],
  [2, '現金'],
  [3, '日用品費'],
])

describe('describeTemplateContent', () => {
  it('借方の科目と貸方の科目を「 / 」で並べる', () => {
    expect(describeTemplateContent(template([line(1, 'debit', 1, null), line(2, 'credit', 2, null)]), names)).toBe(
      '食費 / 現金',
    )
  })

  it('同じ側に複数の科目があるときは「・」でつなぎ、重複は1つにする', () => {
    const t = template([
      line(1, 'debit', 1, null),
      line(2, 'debit', 3, null),
      line(3, 'debit', 1, null),
      line(4, 'credit', 2, null),
    ])

    expect(describeTemplateContent(t, names)).toBe('食費・日用品費 / 現金')
  })

  it('名前が分からない科目は「不明な科目」と表す', () => {
    expect(describeTemplateContent(template([line(1, 'debit', 99, null), line(2, 'credit', 2, null)]), names)).toBe(
      '不明な科目 / 現金',
    )
  })
})

describe('summarizeTemplateAmount', () => {
  it('全行の金額があるときは固定で、借方の合計を返す', () => {
    const t = template([line(1, 'debit', 1, 500), line(2, 'debit', 3, 300), line(3, 'credit', 2, 800)])

    expect(summarizeTemplateAmount(t)).toEqual({ kind: 'fixed', total: 800 })
  })

  it('全行が空欄のときは起票時に入力', () => {
    expect(summarizeTemplateAmount(template([line(1, 'debit', 1, null), line(2, 'credit', 2, null)]))).toEqual({
      kind: 'input',
    })
  })

  it('一部の行だけ金額があるときは一部入力', () => {
    expect(summarizeTemplateAmount(template([line(1, 'debit', 1, 500), line(2, 'credit', 2, null)]))).toEqual({
      kind: 'partial',
    })
  })
})
