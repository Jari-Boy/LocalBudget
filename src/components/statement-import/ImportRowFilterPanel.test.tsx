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
        dates={['2026-09-15', '2026-11-03']}
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
    expect(panel().getByRole('button', { name: /^期間の開始:/ })).toBeInTheDocument()
    expect(panel().getByRole('button', { name: /^期間の終了:/ })).toBeInTheDocument()
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

    // 期間ははじめ月で選ぶ(計画Issue #314)。日付で入れるには「日付で指定」にする
    fireEvent.click(panel().getByRole('checkbox', { name: '日付で指定' }))
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

describe('ImportRowFilterPanel: 期間の日付/月の切替(計画Issue #314)', () => {
  it('はじめは月で選ぶ(「日付で指定」のチェックなし)で、月の選択欄を出す', () => {
    renderPanel()

    expect(panel().getByRole('checkbox', { name: '日付で指定' })).not.toBeChecked()
    expect(panel().getByRole('button', { name: /^期間の開始:/ })).toBeInTheDocument()
  })

  it('チェックを入れると日付入力になる', () => {
    renderPanel()
    fireEvent.click(panel().getByRole('checkbox', { name: '日付で指定' }))

    expect(panel().getByLabelText('期間の開始')).toHaveAttribute('type', 'date')
  })

  it('月を選ぶと、開始月1日の日付を入力に入れて通知する', () => {
    const { onChange } = renderPanel()
    fireEvent.click(panel().getByRole('button', { name: /^期間の開始:/ }))
    const dialog = screen.getByRole('dialog', { name: '期間の開始' })
    fireEvent.click(within(dialog).getByRole('button', { name: '2026年' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '2026年9月' }))

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER_INPUT, dateFrom: '2026-09-01' })
  })

  it('日付を入れたまま月へ切り替えると、含まれる月に広がった日付を通知する', () => {
    const { onChange } = renderPanel({ input: { ...EMPTY_FILTER_INPUT, dateFrom: '2026-10-15', dateTo: '2026-11-03' } })
    fireEvent.click(panel().getByRole('checkbox', { name: '日付で指定' }))

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER_INPUT, dateFrom: '2026-10-01', dateTo: '2026-11-30' })
  })
})

describe('ImportRowFilterPanel: 借方・貸方の切替と金額スライダーは出さない(計画Issue #314)', () => {
  it('取込には借方・貸方の概念が無いので、「借方・貸方を分けて検索」のチェックは出ない', () => {
    renderPanel()

    expect(panel().queryByRole('checkbox', { name: '借方・貸方を分けて検索' })).toBeNull()
  })

  it('金額は取込の符号つきの比較のため、数字入力だけで、スライダーは出ない', () => {
    renderPanel()

    expect(panel().queryByRole('slider')).toBeNull()
    expect(panel().getByLabelText('金額の下限')).toBeInTheDocument()
  })
})
