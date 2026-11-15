/**
 * 用語集の絞り込み(filterGlossaryTerms)のテスト(計画Issue #177)。
 * 検索語が空のときは選んだ区分の用語だけを返し、検索語があるときは区分に関わらず全区分から、
 * 用語名・説明・簿記での言い換えのいずれかに含まれるものを返す。大文字小文字と前後の空白は無視する。
 * 純粋関数のため外部依存はない。
 */
import { describe, expect, it } from 'vitest'
import { filterGlossaryTerms, type GlossaryEntry } from './filterGlossaryTerms'

const ENTRIES: GlossaryEntry[] = [
  { id: 'member', category: 'people', term: '世帯メンバー', description: '誰の口座・取引かを表す名前', bookkeeping: '集計用の軸' },
  { id: 'project', category: 'people', term: 'プロジェクト', description: '何のために使ったかの軸' },
  { id: 'category', category: 'account', term: '区分', description: '資産・負債・純資産・収益・費用の5つ' },
  { id: 'batch', category: 'settlement', term: '精算バッチ', description: '貸し借りをまとめて数える名前', bookkeeping: '補助元帳と同じ働き' },
]

const ids = (entries: GlossaryEntry[]) => entries.map((e) => e.id)

describe('filterGlossaryTerms', () => {
  it('検索語が空のときは、選んだ区分の用語だけを元の順で返す', () => {
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '' }))).toEqual(['member', 'project'])
  })

  it('検索語が空白だけのときも、選んだ区分で絞る', () => {
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'account', query: '   ' }))).toEqual(['category'])
  })

  it('検索語があるときは、選んだ区分に関わらず全区分から探す', () => {
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '精算' }))).toEqual(['batch'])
  })

  it('用語名・説明・簿記での言い換えのどれに含まれても一致する', () => {
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '軸' }))).toEqual(['member', 'project'])
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '補助元帳' }))).toEqual(['batch'])
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '純資産' }))).toEqual(['category'])
  })

  it('英字は大文字小文字を区別しない', () => {
    const entries: GlossaryEntry[] = [{ id: 'csv', category: 'entry', term: '外部明細', description: 'CSV形式のファイル' }]
    expect(ids(filterGlossaryTerms(entries, { category: 'people', query: 'csv' }))).toEqual(['csv'])
  })

  it('検索語の前後の空白は無視する', () => {
    expect(ids(filterGlossaryTerms(ENTRIES, { category: 'people', query: '  区分 ' }))).toEqual(['category'])
  })

  it('一致する用語が無ければ空を返す', () => {
    expect(filterGlossaryTerms(ENTRIES, { category: 'people', query: '存在しない言葉' })).toEqual([])
  })
})
