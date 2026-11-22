// @vitest-environment jsdom
/**
 * ImportRowFilterPanel(明細取込画面の行の絞り込みパネル、計画Issue #258)のコンポーネントテスト。
 * 仕訳一覧の絞り込みパネルと同じ作り(摘要の検索欄・相手科目/取引先/プロジェクト/世帯メンバーの複数選択欄・
 * 条件をクリア・件数)で、各欄の先頭に「未設定」があること、選択・入力が通知されること、
 * 条件があるときだけ「条件をクリア」が出ることを確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import i18n from '../../infrastructure/i18n/i18n'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { EMPTY_FILTER_INPUT, type ImportFilterInput } from './importRowFilter'
import { ImportRowFilterPanel } from './ImportRowFilterPanel'

afterEach(cleanup)

const flat = (name: string, items: Array<[string, string]>): TreeSelectCategory[] => [
  { key: name, name, nodes: items.map(([value, label]) => ({ kind: 'item' as const, value, name: label, isActive: true })) },
]

const members = [
  { id: 1, name: '自分', isActive: true },
  { id: 2, name: '配偶者', isActive: true },
] as HouseholdMember[]

function renderPanel(overrides: Partial<Parameters<typeof ImportRowFilterPanel>[0]> = {}) {
  const onDescriptionChange = vi.fn()
  const onValuesChange = vi.fn()
  const onClear = vi.fn()
  const input: ImportFilterInput = overrides.input ?? EMPTY_FILTER_INPUT
  render(
    <I18nextProvider i18n={i18n}>
      <ImportRowFilterPanel
        input={input}
        onDescriptionChange={onDescriptionChange}
        onValuesChange={onValuesChange}
        onClear={onClear}
        counterAccountCategories={flat('費用', [['10', '食費']])}
        counterpartyCategories={flat('取引先', [['20', 'セブン-イレブン']])}
        projectCategories={flat('プロジェクト', [['30', '出張']])}
        members={members}
        resultCount={7}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onDescriptionChange, onValuesChange, onClear }
}

const panel = () => within(screen.getByRole('search', { name: '明細の絞り込み' }))
const open = (label: string) => {
  fireEvent.click(panel().getByRole('button', { name: new RegExp(`^${label}`) }))
  return within(screen.getByRole('dialog', { name: label }))
}

describe('ImportRowFilterPanel', () => {
  it('摘要の検索欄と、相手科目・取引先・プロジェクト・世帯メンバーの選択欄を、ラベルつきで並べる', () => {
    renderPanel()

    expect(panel().getByRole('searchbox', { name: '摘要で検索' })).toBeInTheDocument()
    for (const label of ['相手科目', '取引先', 'プロジェクト', '世帯メンバー']) {
      expect(panel().getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
  })

  it('摘要の入力を通知する', () => {
    const { onDescriptionChange } = renderPanel()

    fireEvent.change(panel().getByRole('searchbox', { name: '摘要で検索' }), { target: { value: 'セブン' } })

    expect(onDescriptionChange).toHaveBeenCalledWith('セブン')
  })

  it('選択欄の先頭に「未設定」があり、選ぶと、軸と選択した値(複数)を通知する', () => {
    const { onValuesChange } = renderPanel()

    const dialog = open('プロジェクト')
    const labels = dialog.getAllByRole('button').map((b) => b.textContent)
    expect(labels.indexOf('未設定')).toBeGreaterThanOrEqual(0)
    expect(labels.indexOf('未設定')).toBeLessThan(labels.indexOf('出張'))
    fireEvent.click(dialog.getByRole('button', { name: '未設定' }))

    expect(onValuesChange).toHaveBeenCalledWith('project', ['unset'])
  })

  it('世帯メンバーもメンバーのidで通知する', () => {
    const { onValuesChange } = renderPanel()

    fireEvent.click(open('世帯メンバー').getByRole('button', { name: '配偶者' }))

    expect(onValuesChange).toHaveBeenCalledWith('member', ['2'])
  })

  it('いまの件数を出す', () => {
    renderPanel({ resultCount: 7 })

    expect(panel().getByRole('status')).toHaveTextContent('7件')
  })

  it('条件が無いときは「条件をクリア」を出さず、条件があるときだけ出して、押すと通知する', () => {
    const { onClear } = renderPanel()
    expect(panel().queryByRole('button', { name: '条件をクリア' })).not.toBeInTheDocument()
    cleanup()

    const again = renderPanel({ input: { ...EMPTY_FILTER_INPUT, description: 'セブン' } })
    fireEvent.click(panel().getByRole('button', { name: '条件をクリア' }))

    expect(again.onClear).toHaveBeenCalledTimes(1)
    expect(onClear).not.toHaveBeenCalled()
  })
})
