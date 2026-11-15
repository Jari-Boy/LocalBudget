/**
 * journalTemplateForm(計画Issue #201)の単体テスト。テンプレートの編集フォームの状態
 * (摘要・起票者・明細行)と、テンプレートの保存用の入力との変換、保存できるかの検証、
 * 未保存の変更の検知を検証する純粋関数のテスト。金額の空欄は「起票時に入力」、全行の金額があるときだけ
 * 貸借の一致を求めること、起票者・世帯メンバーが未指定(null)のまま保存できることを確認する。DB・DOM非依存。
 */
import { describe, expect, it } from 'vitest'
import type { JournalTemplate, JournalTemplateLine } from '../../domain/journal-template/JournalTemplate'
import {
  buildTemplateUpdateInput,
  isTemplateFormDirty,
  templateFormFromTemplate,
  validateTemplateForm,
  type JournalTemplateForm,
} from './journalTemplateForm'

const line = (overrides: Partial<JournalTemplateLine> & Pick<JournalTemplateLine, 'lineNo' | 'side' | 'accountId'>): JournalTemplateLine => ({
  amount: null,
  projectId: null,
  householdMemberId: null,
  counterpartyId: null,
  settlementBatchId: null,
  ...overrides,
})

const template = (overrides: Partial<JournalTemplate> = {}): JournalTemplate => ({
  id: 1,
  name: 'コンビニ(昼食)',
  memo: '昼食',
  bookkeeperHouseholdMemberId: 10,
  groupId: null,
  sortOrder: 0,
  isActive: true,
  lines: [
    line({ lineNo: 1, side: 'debit', accountId: 1, amount: 500, counterpartyId: 3, householdMemberId: 10 }),
    line({ lineNo: 2, side: 'credit', accountId: 2, amount: 500 }),
  ],
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

describe('templateFormFromTemplate', () => {
  it('テンプレートからフォームの状態を作る(金額は文字列、空欄は空文字、行にkeyを振る)', () => {
    const form = templateFormFromTemplate(
      template({ lines: [line({ lineNo: 1, side: 'debit', accountId: 1, amount: 500 }), line({ lineNo: 2, side: 'credit', accountId: 2 })] }),
    )

    expect(form.memo).toBe('昼食')
    expect(form.bookkeeperId).toBe(10)
    expect(form.lines.map((l) => l.key)).toEqual([1, 2])
    expect(form.lines.map((l) => l.line.amountInput)).toEqual(['500', ''])
    expect(form.lines[0].line).toMatchObject({ accountId: 1, side: 'debit', counterpartyId: null, householdMemberId: null })
  })

  it('摘要が無いテンプレートの摘要は空文字になる', () => {
    expect(templateFormFromTemplate(template({ memo: null })).memo).toBe('')
  })
})

describe('buildTemplateUpdateInput', () => {
  it('フォームを保存用の入力へ変換する(空欄の金額はnull、行番号は入力順)', () => {
    const form = templateFormFromTemplate(
      template({ lines: [line({ lineNo: 1, side: 'debit', accountId: 1, amount: 500, counterpartyId: 3 }), line({ lineNo: 2, side: 'credit', accountId: 2 })] }),
    )

    expect(buildTemplateUpdateInput(form)).toEqual({
      memo: '昼食',
      bookkeeperHouseholdMemberId: 10,
      lines: [
        { side: 'debit', accountId: 1, amount: 500, projectId: null, householdMemberId: null, counterpartyId: 3, settlementBatchId: null },
        { side: 'credit', accountId: 2, amount: null, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      ],
    })
  })

  it('摘要が空白だけのときはnull(消去)にする', () => {
    const form: JournalTemplateForm = { ...templateFormFromTemplate(template()), memo: '   ' }

    expect(buildTemplateUpdateInput(form).memo).toBeNull()
  })
})

describe('validateTemplateForm', () => {
  const base = () => templateFormFromTemplate(template())

  it('正しいフォームは保存できる', () => {
    expect(validateTemplateForm(base())).toEqual({ valid: true })
  })

  it('金額が全行空欄でも保存できる', () => {
    const form = base()
    form.lines = form.lines.map((l) => ({ ...l, line: { ...l.line, amountInput: '' } }))

    expect(validateTemplateForm(form)).toEqual({ valid: true })
  })

  it('一部の行だけ金額があっても、貸借の一致は求めず保存できる', () => {
    const form = base()
    form.lines = [form.lines[0], { ...form.lines[1], line: { ...form.lines[1].line, amountInput: '' } }]

    expect(validateTemplateForm(form)).toEqual({ valid: true })
  })

  it('全行の金額があって貸借が一致しないときは保存できない', () => {
    const form = base()
    form.lines = [form.lines[0], { ...form.lines[1], line: { ...form.lines[1].line, amountInput: '400' } }]

    expect(validateTemplateForm(form)).toEqual({ valid: false, reason: '借方と貸方の合計が一致していません' })
  })

  it('科目が未選択の行があると保存できない', () => {
    const form = base()
    form.lines = [{ ...form.lines[0], line: { ...form.lines[0].line, accountId: null } }, form.lines[1]]

    expect(validateTemplateForm(form)).toEqual({ valid: false, reason: '科目が未選択の行があります' })
  })

  it('借方か貸方のどちらかが無いと保存できない', () => {
    const form = base()
    form.lines = form.lines.map((l) => ({ ...l, line: { ...l.line, side: 'debit' as const } }))

    expect(validateTemplateForm(form)).toEqual({ valid: false, reason: '借方と貸方の行がそれぞれ必要です' })
  })

  it('金額が正の整数でないと保存できない(0・負・小数・文字)', () => {
    for (const bad of ['0', '-5', '1.5', 'abc']) {
      const form = base()
      form.lines = [{ ...form.lines[0], line: { ...form.lines[0].line, amountInput: bad } }, form.lines[1]]

      expect(validateTemplateForm(form)).toEqual({ valid: false, reason: '金額は1以上の整数で入力してください' })
    }
  })

  it('全角数字・桁区切りのカンマ・前後の空白は数字として受け付ける', () => {
    const form = base()
    form.lines = form.lines.map((l) => ({ ...l, line: { ...l.line, amountInput: ' １,２３４ ' } }))

    expect(validateTemplateForm(form)).toEqual({ valid: true })
    expect(buildTemplateUpdateInput(form).lines?.map((l) => l.amount)).toEqual([1234, 1234])
  })
})

describe('isTemplateFormDirty', () => {
  it('保存済みの内容と同じなら未変更', () => {
    const t = template()

    expect(isTemplateFormDirty(templateFormFromTemplate(t), t)).toBe(false)
  })

  it('摘要・起票者・行のどれかが変わると変更あり', () => {
    const t = template()
    const memoChanged = { ...templateFormFromTemplate(t), memo: '夕食' }
    const bookkeeperChanged = { ...templateFormFromTemplate(t), bookkeeperId: null }
    const linesChanged = templateFormFromTemplate(t)
    linesChanged.lines = [{ ...linesChanged.lines[0], line: { ...linesChanged.lines[0].line, amountInput: '600' } }, linesChanged.lines[1]]

    expect(isTemplateFormDirty(memoChanged, t)).toBe(true)
    expect(isTemplateFormDirty(bookkeeperChanged, t)).toBe(true)
    expect(isTemplateFormDirty(linesChanged, t)).toBe(true)
  })

  it('摘要の前後の空白だけの違いや、金額の書式(全角・カンマ)の違いは変更とみなさない', () => {
    const t = template()
    const form = templateFormFromTemplate(t)
    form.memo = ' 昼食 '
    form.lines = form.lines.map((l) => ({ ...l, line: { ...l.line, amountInput: '５００' } }))

    expect(isTemplateFormDirty(form, t)).toBe(false)
  })
})
