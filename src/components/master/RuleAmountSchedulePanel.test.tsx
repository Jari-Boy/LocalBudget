// @vitest-environment jsdom
/**
 * 回ごとの金額表の編集パネル(RuleAmountSchedulePanel、計画Issue #180)のコンポーネントテスト。
 * 表の各回・各行の金額を直接編集でき、1行を直しても後の行は自動で再計算されないこと、確定済みの回は編集できないこと、
 * 各回の残高(指定した行の、それ以降の回の合計)が表示されること、償却・ローンの生成補助で表を作れること
 * (確定済みの回があるときは使えない)、「n回目以降を再計算」でn回目より前を変えずに作り直せることを検証する。
 * 外部依存なし(親から props で受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecurringScheduleRound } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { RuleAmountSchedulePanel } from './RuleAmountSchedulePanel'

afterEach(cleanup)

const LINES = [
  { side: 'debit' as const, accountName: '住宅ローン' },
  { side: 'debit' as const, accountName: '支払利息' },
  { side: 'credit' as const, accountName: '普通預金' },
]

function round(n: number, principal: number, interest: number): RecurringScheduleRound {
  return {
    round: n,
    amounts: [
      { lineNo: 1, amount: principal },
      { lineNo: 2, amount: interest },
      { lineNo: 3, amount: principal + interest },
    ],
  }
}

const SCHEDULE = [round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)]

function renderPanel(overrides: Partial<Parameters<typeof RuleAmountSchedulePanel>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <RuleAmountSchedulePanel
      lines={LINES}
      schedule={SCHEDULE}
      onChange={onChange}
      confirmedRounds={0}
      dueDates={['2026-04-27', '2026-05-27', '2026-06-27']}
      {...overrides}
    />,
  )
  return onChange
}

describe('RuleAmountSchedulePanel', () => {
  it('回・期日・各行の金額・状態を表で表示する', () => {
    renderPanel({ confirmedRounds: 1 })

    const table = screen.getByRole('table', { name: '回ごとの金額表' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('2026-05-27')).toBeInTheDocument()
    expect(within(table).getByText('確定済み')).toBeInTheDocument()
    expect(within(table).getAllByText('未確定')).toHaveLength(2)
  })

  it('指定した行(既定は最初の借方の行)の、各回の残高を表示する', () => {
    renderPanel()

    const table = screen.getByRole('table', { name: '回ごとの金額表' })
    // 元金の行: 1回目の後は 102+98=200、2回目の後は98、最後は0
    expect(within(table).getByText('200')).toBeInTheDocument()
    expect(within(table).getByText('98')).toBeInTheDocument()
    expect(within(table).getAllByText('0').length).toBeGreaterThan(0)
  })

  it('1つのセルを直すと、その回のその行だけが変わり、後の回や他の行は自動では再計算されない', () => {
    const onChange = renderPanel()

    fireEvent.change(screen.getByLabelText('2回目 住宅ローンの金額'), { target: { value: '90' } })

    const next = onChange.mock.calls[0][0] as RecurringScheduleRound[]
    expect(next[1].amounts).toEqual([
      { lineNo: 1, amount: 90 },
      { lineNo: 2, amount: 8 },
      { lineNo: 3, amount: 110 },
    ])
    expect(next[0]).toEqual(SCHEDULE[0])
    expect(next[2]).toEqual(SCHEDULE[2])
  })

  it('確定済みの回のセルは編集できない', () => {
    renderPanel({ confirmedRounds: 1 })

    expect(screen.getByLabelText('1回目 住宅ローンの金額')).toBeDisabled()
    expect(screen.getByLabelText('2回目 住宅ローンの金額')).toBeEnabled()
  })

  it('貸借が一致しない回は、警告を表示する', () => {
    renderPanel({ schedule: [round(1, 100, 10), { round: 2, amounts: [{ lineNo: 1, amount: 1 }, { lineNo: 2, amount: 1 }, { lineNo: 3, amount: 5 }] }] })

    expect(screen.getByText('2回目: 借方と貸方の合計が一致していません')).toBeInTheDocument()
  })

  it('元利均等ローンの条件から表を作成する(元金の合計が借入額と一致する)', () => {
    const onChange = renderPanel({ schedule: [], confirmedRounds: 0, dueDates: [] })

    fireEvent.click(screen.getByRole('radio', { name: '元利均等ローン' }))
    fireEvent.change(screen.getByLabelText('借入額'), { target: { value: '1000000' } })
    fireEvent.change(screen.getByLabelText('年利(%)'), { target: { value: '1.2' } })
    fireEvent.change(screen.getByLabelText('返済回数'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('元金の行'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('利息の行'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('支払元の行'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '表を作成' }))

    const created = onChange.mock.calls[0][0] as RecurringScheduleRound[]
    expect(created).toHaveLength(12)
    expect(created.reduce((sum, r) => sum + r.amounts[0].amount, 0)).toBe(1000000)
    expect(created[0].amounts[1].amount).toBe(1000)
  })

  it('定額法の償却の条件から表を作成する(合計が 取得価額 − 残存価額)', () => {
    const lines = [
      { side: 'debit' as const, accountName: '減価償却費' },
      { side: 'credit' as const, accountName: '減価償却累計額' },
    ]
    const onChange = renderPanel({ lines, schedule: [], dueDates: [] })

    fireEvent.click(screen.getByRole('radio', { name: '定額法の償却' }))
    fireEvent.change(screen.getByLabelText('取得価額'), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('償却回数'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('償却費の行'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('貸方の行'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '表を作成' }))

    const created = onChange.mock.calls[0][0] as RecurringScheduleRound[]
    expect(created).toHaveLength(5)
    expect(created.reduce((sum, r) => sum + r.amounts[0].amount, 0)).toBe(99999)
  })

  it('確定済みの回があるときは、表の作成は使えない(n回目以降の再計算を使う)', () => {
    renderPanel({ confirmedRounds: 1 })

    expect(screen.getByRole('button', { name: '表を作成' })).toBeDisabled()
  })

  it('n回目以降を再計算すると、n回目より前は変えずに、n回目以降が作り直される', () => {
    const onChange = renderPanel({ confirmedRounds: 1 })

    fireEvent.click(screen.getByRole('radio', { name: '元利均等ローン' }))
    fireEvent.change(screen.getByLabelText('元金の行'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('利息の行'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('支払元の行'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('何回目から'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('更新時の残高'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('新しい年利(%)'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('残り回数'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '2回目以降を再計算' }))

    const next = onChange.mock.calls[0][0] as RecurringScheduleRound[]
    expect(next).toHaveLength(6)
    expect(next[0]).toEqual(SCHEDULE[0])
    expect(next.slice(1).reduce((sum, r) => sum + r.amounts[0].amount, 0)).toBe(5000)
  })

  it('確定済みの回より前からの再計算は、エラーを表示して表を変えない', () => {
    const onChange = renderPanel({ confirmedRounds: 1 })

    fireEvent.click(screen.getByRole('radio', { name: '元利均等ローン' }))
    fireEvent.change(screen.getByLabelText('元金の行'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('利息の行'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('支払元の行'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('何回目から'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('更新時の残高'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('残り回数'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '1回目以降を再計算' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('確定済みの回は再計算できません')
  })
})
