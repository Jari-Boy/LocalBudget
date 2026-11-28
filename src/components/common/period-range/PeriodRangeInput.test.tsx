// @vitest-environment jsdom
/**
 * 期間入力 PeriodRangeInput(日付/月の切替つき、計画Issue #314)のコンポーネントテスト。
 * はじめは月の選択(チェックなし)で、月の途中の日付が入った条件で開いたときだけ日付入力になること、「日付で指定」のチェックで日付入力と月の選択欄を切り替えられること、月モードの選択は開始月1日〜終了月末日の日付に変換して
 * 通知すること、日付から月へ切り替えると含まれる月に広がること、月の選択欄に「指定なし」があり、月は新しい順に並ぶことを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeriodRangeInput } from './PeriodRangeInput'

afterEach(cleanup)

const dates = ['2026-09-15', '2026-11-03']

function Harness({
  initial = { from: '', to: '' },
  onChange,
}: {
  initial?: { from: string; to: string }
  onChange?: (from: string, to: string) => void
}) {
  const [range, setRange] = useState(initial)
  return (
    <PeriodRangeInput
      label="期間"
      fromLabel="期間の開始"
      toLabel="期間の終了"
      byDateLabel="日付で指定"
      unsetLabel="指定なし"
      from={range.from}
      to={range.to}
      dates={dates}
      onChange={(from, to) => {
        setRange({ from, to })
        onChange?.(from, to)
      }}
    />
  )
}

describe('PeriodRangeInput', () => {
  it('はじめは月で選ぶ(「日付で指定」のチェックなし)で、開始・終了の月の選択欄を出す', () => {
    render(<Harness />)

    expect(screen.getByRole('checkbox', { name: '日付で指定' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '期間の開始' })).toBeInTheDocument()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('月初〜月末の期間で開いたときも、月の選択欄に選択中の月が入る', () => {
    render(<Harness initial={{ from: '2026-09-01', to: '2026-10-31' }} />)

    expect(screen.getByRole('combobox', { name: '期間の開始' })).toHaveValue('2026-09')
    expect(screen.getByRole('combobox', { name: '期間の終了' })).toHaveValue('2026-10')
  })

  it('月の途中の日付が入った期間で開いたときは、日付で指定(チェックあり)で日付入力を出す', () => {
    render(<Harness initial={{ from: '2026-10-01', to: '2026-10-20' }} />)

    expect(screen.getByRole('checkbox', { name: '日付で指定' })).toBeChecked()
    expect(screen.getByLabelText('期間の開始')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('期間の終了')).toHaveValue('2026-10-20')
  })

  it('日付入力を変えると、開始・終了の日付で通知する', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ from: '2026-10-01', to: '2026-10-20' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('期間の終了'), { target: { value: '2026-10-25' } })

    expect(onChange).toHaveBeenLastCalledWith('2026-10-01', '2026-10-25')
  })

  it('チェックを外すと、日付が含まれる月に広がって通知され、月の選択欄に切り替わる', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ from: '2026-10-15', to: '2026-11-03' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '日付で指定' }))

    expect(onChange).toHaveBeenLastCalledWith('2026-10-01', '2026-11-30')
    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect(screen.getByRole('combobox', { name: '期間の開始' })).toHaveValue('2026-10')
    expect(screen.getByRole('combobox', { name: '期間の終了' })).toHaveValue('2026-11')
  })

  it('月の選択欄は、仕訳のある月を途切れなく新しい順に並べ、先頭に「指定なし」を置く', () => {
    render(<Harness />)

    const options = Array.from(screen.getByRole('combobox', { name: '期間の開始' }).querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['指定なし', '2026年11月', '2026年10月', '2026年9月'])
  })

  it('月を選ぶと、開始は月初日・終了は月末日の日付で通知する', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: '期間の開始' }), { target: { value: '2026-09' } })
    fireEvent.change(screen.getByRole('combobox', { name: '期間の終了' }), { target: { value: '2026-10' } })

    expect(onChange).toHaveBeenLastCalledWith('2026-09-01', '2026-10-31')
  })

  it('月の選択を「指定なし」に戻すと、その側の日付を空にして通知する', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ from: '2026-09-01', to: '2026-10-31' }} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: '期間の開始' }), { target: { value: '' } })

    expect(onChange).toHaveBeenLastCalledWith('', '2026-10-31')
  })

  it('月モードからチェックを入れると、日付入力に戻り、広げた範囲の日付がそのまま入っている', () => {
    render(<Harness initial={{ from: '2026-10-15', to: '2026-11-03' }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '日付で指定' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '日付で指定' }))

    expect(screen.getByLabelText('期間の開始')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('期間の終了')).toHaveValue('2026-11-30')
  })
})
