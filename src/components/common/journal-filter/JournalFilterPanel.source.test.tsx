// @vitest-environment jsdom
/**
 * 仕訳の絞り込みパネル(JournalFilterPanel)の「出どころ」欄に、取り込んだ金融機関を階層で並べて絞り込めること
 * (計画Issue #289)のコンポーネントテスト。「外部明細」を親(科目などと同じグループ行で、「すべて」ボタンで選ぶ)、各金融機関を子としてインデントして並べ、
 * 子を選ぶと financialInstitutionNames、親を選ぶと sourceTypes(external_import)、「金融機関が不明」を選ぶと null で
 * 通知することを検証する。外部依存なし(絞り込みの実行自体はドメイン層の責務のため、条件の生成だけを見る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { JournalFilterPanel, type JournalFilterOptions } from './JournalFilterPanel'
import { buildSourceFilterChoices } from './journalFilterModel'

afterEach(cleanup)

const empty = [{ key: 'flat', name: '', nodes: [] }]
const options: JournalFilterOptions = {
  accountCategories: empty,
  counterpartyCategories: empty,
  projectCategories: empty,
  members: [],
  batches: [],
  sourceTypes: buildSourceFilterChoices([
    { sourceType: 'external_import', financialInstitutionName: '三井住友銀行' },
    { sourceType: 'external_import', financialInstitutionName: null },
    { sourceType: 'manual' },
  ]),
}

function Harness({ initial = {}, onFilter }: { initial?: JournalEntryFilter; onFilter?: (f: JournalEntryFilter) => void }) {
  const [filter, setFilter] = useState<JournalEntryFilter>(initial)
  return (
    <JournalFilterPanel
      filter={filter}
      options={options}
      onChange={(next) => {
        setFilter(next)
        onFilter?.(next)
      }}
    />
  )
}

/** 出どころ欄を開く。階層つきの項目は共通部品の既定で閉じているので、「外部明細」の行も押して開き、子を出す */
const openSource = () => {
  fireEvent.click(screen.getByRole('button', { name: /^出どころ:/ }))
  const dialog = screen.getByRole('dialog', { name: '出どころ' })
  fireEvent.click(within(dialog).getByRole('button', { name: '外部明細' }))
  return dialog
}

describe('JournalFilterPanel(出どころの金融機関)', () => {
  it('「外部明細」・各金融機関・「外部明細(金融機関が不明)」・ほかの作成経路を選択肢に並べる', () => {
    render(<Harness />)
    const dialog = openSource()

    for (const name of ['外部明細','三井住友銀行', '外部明細(金融機関が不明)', '手入力']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('金融機関を選ぶと、financialInstitutionNames で通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(within(openSource()).getByRole('button', { name: '三井住友銀行' }))

    expect(onFilter).toHaveBeenLastCalledWith({ financialInstitutionNames: ['三井住友銀行'] })
  })

  it('「外部明細」の「すべて」を押すと、sourceTypes に external_import を入れて通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(within(openSource()).getByRole('button', { name: '外部明細をすべて選ぶ' }))

    expect(onFilter).toHaveBeenLastCalledWith({ sourceTypes: ['external_import'] })
  })

  it('「外部明細(金融機関が不明)」を選ぶと、null を入れて通知し、金融機関と手入力を併用できる', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    const dialog = openSource()
    fireEvent.click(within(dialog).getByRole('button', { name: '外部明細(金融機関が不明)' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '手入力' }))

    expect(onFilter).toHaveBeenLastCalledWith({ sourceTypes: ['manual'], financialInstitutionNames: [null] })
  })

  it('金融機関で絞り込み中は、出どころ欄の表示に選んだ金融機関名が出る', () => {
    render(<Harness initial={{ financialInstitutionNames: ['三井住友銀行'] }} />)

    expect(screen.getByRole('button', { name: /^出どころ:.*三井住友銀行/ })).toBeInTheDocument()
  })
})
