// @vitest-environment jsdom
/**
 * 金額の範囲入力 AmountRangeInput(数字入力+2つ摘みのスライダー、計画Issue #314)のコンポーネントテスト。
 * 数字入力とスライダーが双方向に同期すること(スライダーのキーボード操作が数字入力の値になる)、下限が上限を越えないこと、
 * 右端が「上限なし」(空)であること、目盛りの範囲外の入力値はスライダーの端に寄せて表示しつつ入力値は保持すること、
 * スライダーに役割・値の読み上げ(aria属性)が付くことを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { AmountRangeInput } from './AmountRangeInput'

afterEach(cleanup)

function Harness({ initial = { min: '', max: '' }, dataMax = 0 }: { initial?: { min: string; max: string }; dataMax?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <AmountRangeInput
      label="金額"
      minLabel="金額の下限"
      maxLabel="金額の上限"
      noLimitLabel="上限なし"
      minText={value.min}
      maxText={value.max}
      dataMax={dataMax}
      onMinTextChange={(min) => setValue((v) => ({ ...v, min }))}
      onMaxTextChange={(max) => setValue((v) => ({ ...v, max }))}
    />
  )
}

const minThumb = () => screen.getByRole('slider', { name: '金額の下限のスライダー' })
const maxThumb = () => screen.getByRole('slider', { name: '金額の上限のスライダー' })

describe('AmountRangeInput', () => {
  it('数字入力2つと、下限・上限の2つ摘みのスライダーを出す', () => {
    render(<Harness />)

    expect(screen.getByRole('textbox', { name: '金額の下限' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '金額の上限' })).toBeInTheDocument()
    expect(minThumb()).toBeInTheDocument()
    expect(maxThumb()).toBeInTheDocument()
  })

  it('指定なしのときは、下限の摘みが左端(0)・上限の摘みが右端(100)で、上限は「上限なし」と読み上げる', () => {
    render(<Harness />)

    expect(minThumb()).toHaveAttribute('aria-valuenow', '0')
    expect(maxThumb()).toHaveAttribute('aria-valuenow', '100')
    expect(maxThumb()).toHaveAttribute('aria-valuetext', '上限なし')
    expect(screen.getByRole('textbox', { name: '金額の上限' })).toHaveAttribute('placeholder', '上限なし')
  })

  it('スライダーに役割(slider)と範囲(0〜100)・金額の読み上げ(円)が付く', () => {
    render(<Harness initial={{ min: '1000', max: '100000' }} />)

    expect(minThumb()).toHaveAttribute('aria-valuemin', '0')
    expect(minThumb()).toHaveAttribute('aria-valuemax', '100')
    expect(minThumb()).toHaveAttribute('aria-valuenow', '20')
    expect(minThumb()).toHaveAttribute('aria-valuetext', '1,000円')
    expect(maxThumb()).toHaveAttribute('aria-valuenow', '60')
    expect(maxThumb()).toHaveAttribute('aria-valuetext', '100,000円')
  })

  it('数字入力に打った金額で、スライダーの摘みが動く(入力→スライダー)', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: '金額の下限' }), { target: { value: '10000' } })

    expect(minThumb()).toHaveAttribute('aria-valuenow', '40')
  })

  it('スライダーをキーボードで動かすと、数字入力に金額が入る(スライダー→入力)', () => {
    render(<Harness />)
    fireEvent.keyDown(minThumb(), { key: 'PageUp' })

    // 下限を10%(=目盛り0〜1,000円の半分の500円)へ
    expect(screen.getByRole('textbox', { name: '金額の下限' })).toHaveValue('500')
  })

  it('上限の摘みを左へ動かすと数字入力に上限が入り、右端へ戻すと空(上限なし)になる', () => {
    render(<Harness />)
    fireEvent.keyDown(maxThumb(), { key: 'PageDown' })
    expect(screen.getByRole('textbox', { name: '金額の上限' })).not.toHaveValue('')

    fireEvent.keyDown(maxThumb(), { key: 'End' })
    expect(screen.getByRole('textbox', { name: '金額の上限' })).toHaveValue('')
  })

  it('下限の摘みは上限の摘みを越えて動かせない', () => {
    render(<Harness initial={{ min: '1000', max: '1000' }} />)
    fireEvent.keyDown(minThumb(), { key: 'ArrowRight' })

    expect(screen.getByRole('textbox', { name: '金額の下限' })).toHaveValue('1000')
  })

  it('目盛りの範囲を超える入力値は、摘みを右端に寄せるが、入力した値は保つ', () => {
    render(<Harness initial={{ min: '', max: '99999999' }} />)

    expect(maxThumb()).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('textbox', { name: '金額の上限' })).toHaveValue('99999999')
  })

  it('表示データの最大金額が大きいほど、右端の手前(100万円より先)の目盛りがその金額まで伸びる', () => {
    render(<Harness initial={{ min: '', max: '5000000' }} dataMax={9_000_000} />)

    // 100万円=80%、最大900万円=100%の直線補間で、500万円はちょうど中間の90%
    expect(maxThumb()).toHaveAttribute('aria-valuenow', '90')
  })
})
