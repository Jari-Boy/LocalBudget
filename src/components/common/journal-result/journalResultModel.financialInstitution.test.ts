/**
 * 仕訳の出どころタグの、金融機関名での表示(journalResultModel、計画Issue #289)のユニットテスト。
 * 外部明細から取り込んだ仕訳は、金融機関名が分かればそれをタグの文言にし(色は従来の青のまま)、分からなければ
 * 従来の「外部明細」にする。手入力・割勘などほかの出どころは金融機関名の有無によらず変わらない。
 * 仕訳の結果一覧の1行要約(JournalResultItem)が金融機関名を引き継ぐことも検証する。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../../../domain/journal/JournalEntry'
import { SOURCE_TAGS, resolveSourceTag, toJournalResultItem } from './journalResultModel'

describe('resolveSourceTag', () => {
  it('取込済みで金融機関名があれば、タグの文言が金融機関名になり、色は外部明細と同じ', () => {
    const tag = resolveSourceTag('external_import', '三井住友銀行')

    expect(tag).toEqual({ ...SOURCE_TAGS.external_import, label: '三井住友銀行' })
  })

  it('金融機関名がnull・未設定の取込済みは、従来どおり「外部明細」', () => {
    expect(resolveSourceTag('external_import', null)).toBe(SOURCE_TAGS.external_import)
    expect(resolveSourceTag('external_import')).toBe(SOURCE_TAGS.external_import)
    expect(resolveSourceTag('external_import', '')).toBe(SOURCE_TAGS.external_import)
  })

  it('取込でない出どころは、金融機関名を渡されても従来のタグのまま', () => {
    expect(resolveSourceTag('manual', '三井住友銀行')).toBe(SOURCE_TAGS.manual)
    expect(resolveSourceTag('expense_splitting', '三井住友銀行')).toBe(SOURCE_TAGS.expense_splitting)
  })
})

describe('toJournalResultItem', () => {
  const entry = (financialInstitutionName?: string | null): JournalEntry => ({
    id: 1,
    entryDate: '2026-11-01',
    memo: 'ガス',
    comment: null,
    currency: 'JPY',
    sourceType: 'external_import',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    ...(financialInstitutionName === undefined ? {} : { financialInstitutionName }),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lines: [],
  })

  it('仕訳の金融機関名を、1行要約のfinancialInstitutionNameに引き継ぐ', () => {
    expect(toJournalResultItem(entry('楽天カード'), () => '').financialInstitutionName).toBe('楽天カード')
  })

  it('金融機関名が無い仕訳は、1行要約でもnullになる', () => {
    expect(toJournalResultItem(entry(), () => '').financialInstitutionName).toBeNull()
  })
})
