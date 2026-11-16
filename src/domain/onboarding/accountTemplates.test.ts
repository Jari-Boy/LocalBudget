/**
 * 初期設定で選ぶ勘定科目テンプレート(accountTemplates)のテスト(計画Issue #177)。
 * 最小・標準・簿記寄りの3種が、収益・費用の科目名の確定リストを持ち、
 * 段階的に科目が増える(最小 ⊂ 標準 ⊂ 簿記寄り相当)ことと、「簿記寄り」で増える科目を
 * 判別できることを検証する。純粋なデータ定義のため外部依存はない。
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_TEMPLATE_KEYS,
  ACCOUNT_TEMPLATES,
  CASH_ACCOUNT_NAME,
  PROTECTED_REVENUE_EXPENSE_NAMES,
  findTemplateAdditions,
} from './accountTemplates'

describe('ACCOUNT_TEMPLATES', () => {
  it('テンプレートは最小・標準・簿記寄りの3種である', () => {
    expect(ACCOUNT_TEMPLATE_KEYS).toEqual(['minimal', 'standard', 'bookkeeping'])
  })

  it('標準は、収益3件・費用13件である', () => {
    expect(ACCOUNT_TEMPLATES.standard.revenue).toEqual(['給与収入', '副業収入', 'その他収入'])
    expect(ACCOUNT_TEMPLATES.standard.expense).toHaveLength(13)
    expect(ACCOUNT_TEMPLATES.standard.expense).toContain('その他費用')
  })

  it('最小は標準より科目が少なく、すべて標準に含まれる', () => {
    const { minimal, standard } = ACCOUNT_TEMPLATES
    expect(minimal.revenue.length).toBeLessThanOrEqual(standard.revenue.length)
    expect(minimal.expense.length).toBeLessThan(standard.expense.length)
    for (const name of [...minimal.revenue, ...minimal.expense]) {
      expect([...standard.revenue, ...standard.expense]).toContain(name)
    }
  })

  it('簿記寄りは、標準の科目をすべて含み、税・社会保険・利息などが加わる', () => {
    const { standard, bookkeeping } = ACCOUNT_TEMPLATES
    for (const name of standard.revenue) expect(bookkeeping.revenue).toContain(name)
    for (const name of standard.expense) expect(bookkeeping.expense).toContain(name)
    expect(bookkeeping.expense).toEqual(expect.arrayContaining(['所得税', '住民税', '社会保険料', '支払利息']))
    expect(bookkeeping.revenue).toEqual(expect.arrayContaining(['賞与', '事業収入', '利息・配当']))
  })

  it('どのテンプレートにも、システムが常に入れる科目(雑収入・雑損失)は含まれない', () => {
    for (const key of ACCOUNT_TEMPLATE_KEYS) {
      const names = [...ACCOUNT_TEMPLATES[key].revenue, ...ACCOUNT_TEMPLATES[key].expense]
      for (const protectedName of PROTECTED_REVENUE_EXPENSE_NAMES) {
        expect(names).not.toContain(protectedName)
      }
    }
  })

  it('最初から入る資産の科目は「現金」である', () => {
    expect(CASH_ACCOUNT_NAME).toBe('現金')
  })
})

describe('findTemplateAdditions', () => {
  it('標準に対する簿記寄りの追加分(プレビューで強調する科目)を返す', () => {
    const additions = findTemplateAdditions('bookkeeping')
    expect(additions).toEqual(expect.arrayContaining(['賞与', '所得税', '減価償却費']))
    expect(additions).not.toContain('給与収入')
  })

  it('最小・標準には追加分が無い', () => {
    expect(findTemplateAdditions('minimal')).toEqual([])
    expect(findTemplateAdditions('standard')).toEqual([])
  })
})
