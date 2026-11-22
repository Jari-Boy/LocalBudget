// @vitest-environment jsdom
/**
 * ImportRowFilterPanel(明細取込画面の行の絞り込みパネル、計画Issue #258)のコンポーネントテスト。
 * 仕訳一覧の絞り込みパネルと同じ作り(摘要の検索欄・期間・金額・相手科目/取引先/プロジェクト/世帯メンバー/精算バッチの
 * 複数選択欄・条件をクリア・件数)で、各欄の先頭に「未設定」(精算バッチは「未割当」)があること、
 * 入力・選択が変更後の入力として通知されること、条件があるときだけ「条件をクリア」が出ることを確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
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

const batches = [{ id: 7, name: '10月分の立替' }] as SettlementBatch[]

function renderPanel(overrides: Partial<Parameters<typeof ImportRowFilterPanel>[0]> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  const input: ImportFilterInput = overrides.input ?? EMPTY_FILTER_INPUT
  render(
    <I18nextProvider i18n={i18n}>
      <ImportRowFilterPanel
        input={input}
        onChange={onChange}
        onClear={onClear}
        counterAccountCategories={flat('費用', [['10', '食費']])}
        counterpartyCategories={flat('取引先', [['20', 'セブン-イレブン']])}
        projectCategories={flat('プロジェクト', [['30', '出張']])}
        members={members}
        batches={batches}
        resultCount={7}
        {...overrides}
      />
    </I18nextProvider>,
  )
  return { onChange, onClear }
}

const panel = () => within(screen.getByRole('search', { name: '明細の絞り込み' }))
const open = (label: string) => {
  fireEvent.click(panel().getByRole('button', { name: new RegExp(`^${label}`) }))
  return within(screen.getByRole('dialog', { name: label }))
}

describe('ImportRowFilterPanel', () => {
  it('摘要の検索欄・期間・金額の欄と、相手科目・取引先・プロジェクト・世帯メンバー・精算バッチの選択欄を、ラベルつきで並べる', () => {
    renderPanel()

    expect(panel().getByRole('searchbox', { name: '摘要で検索' })).toBeInTheDocument()
    expect(panel().getByLabelText('期間の開始')).toBeInTheDocument()
    expect(panel().getByLabelText('期間の終了')).toBeInTheDocument()
    expect(panel().getByLabelText('金額の下限')).toBeInTheDocument()
    expect(panel().getByLabelText('金額の上限')).toBeInTheDocument()
    for (const label of ['相手科目', '取引先', 'プロジェクト', '世帯メンバー', '精算バッチ']) {
      expect(panel().getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
  })

  it('摘要・期間・金額の入力を、ほかの条件はそのままにして通知する', () => {
    const base: ImportFilterInput = { ...EMPTY_FILTER_INPUT, description: '既存' }
    const { onChange } = renderPanel({ input: base })

    fireEvent.change(panel().getByRole('searchbox', { name: '摘要で検索' }), { target: { value: 'セブン' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...base, description: 'セブン' })

    fireEvent.change(panel().getByLabelText('期間の開始'), { target: { value: '2026-10-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...base, dateFrom: '2026-10-01' })

    fireEvent.change(panel().getByLabelText('期間の終了'), { target: { value: '2026-10-31' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...base, dateTo: '2026-10-31' })

    fireEvent.change(panel().getByLabelText('金額の下限'), { target: { value: '500' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...base, amountMin: '500' })

    fireEvent.change(panel().getByLabelText('金額の上限'), { target: { value: '1000' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...base, amountMax: '1000' })
  })

  it('選択欄の先頭に「未設定」があり、選ぶと、その軸の選択(複数)を入力に入れて通知する', () => {
    const { onChange } = renderPanel()

    const dialog = open('プロジェクト')
    const labels = dialog.getAllByRole('button').map((b) => b.textContent)
    expect(labels.indexOf('未設定')).toBeGreaterThanOrEqual(0)
    expect(labels.indexOf('未設定')).toBeLessThan(labels.indexOf('出張'))
    fireEvent.click(dialog.getByRole('button', { name: '未設定' }))

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER_INPUT, values: { ...EMPTY_FILTER_INPUT.values, project: ['unset'] } })
  })

  it('世帯メンバーはメンバーのid、精算バッチはバッチのidで通知する。精算バッチの先頭は「未割当」', () => {
    const { onChange } = renderPanel()

    fireEvent.click(open('世帯メンバー').getByRole('button', { name: '配偶者' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER_INPUT, values: { ...EMPTY_FILTER_INPUT.values, member: ['2'] } })
    cleanup()

    renderPanel({ onChange })
    const batchDialog = open('精算バッチ')
    expect(batchDialog.getByRole('button', { name: '未割当' })).toBeInTheDocument()
    fireEvent.click(batchDialog.getByRole('button', { name: '10月分の立替' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER_INPUT, values: { ...EMPTY_FILTER_INPUT.values, batch: ['7'] } })
  })

  it('いまの件数を出す', () => {
    renderPanel({ resultCount: 7 })

    expect(panel().getByRole('status')).toHaveTextContent('7件')
  })

  it('条件が無いときは「条件をクリア」を出さず、条件があるときだけ出して、押すと通知する(期間・金額だけでも出る)', () => {
    const { onClear } = renderPanel()
    expect(panel().queryByRole('button', { name: '条件をクリア' })).not.toBeInTheDocument()
    cleanup()

    const withPeriod = renderPanel({ input: { ...EMPTY_FILTER_INPUT, dateFrom: '2026-10-01' } })
    fireEvent.click(panel().getByRole('button', { name: '条件をクリア' }))
    expect(withPeriod.onClear).toHaveBeenCalledTimes(1)
    cleanup()

    renderPanel({ input: { ...EMPTY_FILTER_INPUT, amountMax: '1000' } })
    expect(panel().getByRole('button', { name: '条件をクリア' })).toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
  })
})
