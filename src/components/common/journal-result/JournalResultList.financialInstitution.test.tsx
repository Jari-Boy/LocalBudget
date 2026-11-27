// @vitest-environment jsdom
/**
 * 仕訳の結果一覧(JournalResultList)の、出どころタグの金融機関名表示(計画Issue #289)のコンポーネントテスト。
 * 外部明細から取り込んだ仕訳は、金融機関名が分かればタグが金融機関名になり、分からなければ「外部明細」のまま、
 * 手入力など他の出どころは変わらないことを検証する。外部依存なし(整形済みの行データ JournalResultItem だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { JournalResultList } from './JournalResultList'
import type { JournalResultItem } from './journalResultModel'

afterEach(cleanup)

const base = { memo: '摘要', amount: 100, currency: 'JPY', entryDate: '2026-11-01', debitSummary: '食費', creditSummary: '普通預金' }
const items: JournalResultItem[] = [
  { ...base, id: 1, sourceType: 'external_import', financialInstitutionName: '三井住友銀行' },
  { ...base, id: 2, sourceType: 'external_import', financialInstitutionName: null },
  { ...base, id: 3, sourceType: 'external_import' },
  { ...base, id: 4, sourceType: 'manual', financialInstitutionName: '三井住友銀行' },
]

describe('JournalResultList(出どころタグの金融機関名)', () => {
  it('取り込んだ金融機関が分かる仕訳は金融機関名、分からない仕訳は「外部明細」、取込でない仕訳は従来のタグを出す', () => {
    render(<JournalResultList items={items} selectionMode="none" selectedIds={[]} onSelectionChange={() => {}} />)

    const rows = within(screen.getByRole('group', { name: '仕訳一覧。上下キーで選択を移動' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('三井住友銀行')
    expect(rows[0]).not.toHaveTextContent('外部明細')
    expect(rows[1]).toHaveTextContent('外部明細')
    expect(rows[2]).toHaveTextContent('外部明細')
    expect(rows[3]).toHaveTextContent('手入力')
    expect(rows[3]).not.toHaveTextContent('三井住友銀行')
  })
})
