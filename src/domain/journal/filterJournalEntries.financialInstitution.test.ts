/**
 * filterJournalEntries の「取り込んだ金融機関」(financialInstitutionNames、計画Issue #289)での絞り込みのユニットテスト。
 * 外部明細から取り込んだ仕訳を金融機関名で絞り込めること、nullが「金融機関が不明な取込済み」を表すこと、
 * 同じ「出どころ」の軸である作成経路(sourceTypes)と併用したときはORになること、取込でない仕訳には金融機関名の
 * 指定が一致しないことを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from './JournalEntry'
import { filterJournalEntries } from './filterJournalEntries'

function buildEntry(id: number, sourceType: JournalEntry['sourceType'], financialInstitutionName?: string | null): JournalEntry {
  return {
    id,
    entryDate: '2026-11-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType,
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    ...(financialInstitutionName === undefined ? {} : { financialInstitutionName }),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lines: [],
  }
}

const entries = [
  buildEntry(1, 'external_import', '三井住友銀行'),
  buildEntry(2, 'external_import', '楽天カード'),
  buildEntry(3, 'external_import', null),
  buildEntry(4, 'external_import'),
  buildEntry(5, 'manual'),
  buildEntry(6, 'recurring_generated'),
]
const ids = (result: readonly JournalEntry[]) => result.map((entry) => entry.id)

describe('金融機関名での絞り込み', () => {
  it('指定した金融機関から取り込んだ仕訳だけが残る', () => {
    expect(ids(filterJournalEntries(entries, [], { financialInstitutionNames: ['三井住友銀行'] }))).toEqual([1])
  })

  it('複数の金融機関を指定すると、いずれかに一致する仕訳が残る(軸の中はOR)', () => {
    expect(ids(filterJournalEntries(entries, [], { financialInstitutionNames: ['三井住友銀行', '楽天カード'] }))).toEqual([1, 2])
  })

  it('null を指定すると、金融機関が不明な取込済みの仕訳(未設定・省略)だけが残る', () => {
    expect(ids(filterJournalEntries(entries, [], { financialInstitutionNames: [null] }))).toEqual([3, 4])
  })

  it('手入力など取込でない仕訳は、null を指定しても残らない', () => {
    expect(ids(filterJournalEntries(entries, [], { financialInstitutionNames: [null] }))).not.toContain(5)
  })

  it('空配列・未指定は絞り込みなし', () => {
    expect(ids(filterJournalEntries(entries, [], { financialInstitutionNames: [] }))).toEqual([1, 2, 3, 4, 5, 6])
    expect(ids(filterJournalEntries(entries, [], {}))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('作成経路(sourceTypes)と併用すると、どちらかに該当する仕訳が残る(出どころの軸の中はOR)', () => {
    const result = filterJournalEntries(entries, [], { sourceTypes: ['manual'], financialInstitutionNames: ['楽天カード'] })

    expect(ids(result)).toEqual([2, 5])
  })

  it('作成経路に external_import(すべて)を指定すれば、金融機関によらず取込済みの仕訳がすべて残る', () => {
    expect(ids(filterJournalEntries(entries, [], { sourceTypes: ['external_import'] }))).toEqual([1, 2, 3, 4])
  })
})
