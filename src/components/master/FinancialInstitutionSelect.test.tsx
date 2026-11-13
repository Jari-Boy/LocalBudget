// @vitest-environment jsdom
/**
 * FinancialInstitutionSelect(金融機関名の選択欄、計画Issue #183)のコンポーネントテスト。
 * マスタの「明細マッピング」タブと取込画面のマッピング作成ダイアログで共通に使う部品で、
 * 既存の金融機関名を候補として選ばせ、候補にない場合だけ「新しい金融機関名を入力…」で
 * 入力欄を出すことを確認する。DB非依存、外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { FinancialInstitutionSelect } from './FinancialInstitutionSelect'

afterEach(cleanup)

/** 親が値を持つ形で描画し、変更後の値をdata属性で観測する */
function Host({ initial, candidates }: { initial: string; candidates: string[] }) {
  const [value, setValue] = useState(initial)
  return (
    <I18nextProvider i18n={i18n}>
      <label htmlFor="inst">金融機関名</label>
      <FinancialInstitutionSelect id="inst" className="x" value={value} candidates={candidates} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </I18nextProvider>
  )
}

const CANDIDATES = ['PayPayカード', '楽天カード', '楽天銀行']

describe('FinancialInstitutionSelect', () => {
  it('候補が選択肢に並び、現在の値が選ばれている', () => {
    render(<Host initial="楽天カード" candidates={CANDIDATES} />)

    const select = screen.getByLabelText('金融機関名')
    expect(select).toHaveValue('楽天カード')
    expect(screen.getByRole('option', { name: 'PayPayカード' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '楽天銀行' })).toBeInTheDocument()
    expect(screen.queryByLabelText('新しい金融機関名')).not.toBeInTheDocument()
  })

  it('候補を選ぶと、その名前が値として通知される', () => {
    render(<Host initial="" candidates={CANDIDATES} />)

    fireEvent.change(screen.getByLabelText('金融機関名'), { target: { value: '楽天銀行' } })

    expect(screen.getByTestId('value')).toHaveTextContent('楽天銀行')
  })

  it('「新しい金融機関名を入力…」を選ぶと入力欄が出て、入力した名前が値として通知される', () => {
    render(<Host initial="楽天カード" candidates={CANDIDATES} />)

    fireEvent.change(screen.getByLabelText('金融機関名'), { target: { value: '__new__' } })
    const input = screen.getByLabelText('新しい金融機関名')
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: '三井住友カード' } })

    expect(screen.getByTestId('value')).toHaveTextContent('三井住友カード')
    expect(screen.getByLabelText('金融機関名')).toHaveValue('__new__')
  })

  it('入力中の名前が候補と表記ゆれだけの違いなら、その候補の名前で通知される', () => {
    render(<Host initial="" candidates={CANDIDATES} />)

    fireEvent.change(screen.getByLabelText('金融機関名'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('新しい金融機関名'), { target: { value: 'ＰａｙＰａｙ カード' } })

    expect(screen.getByTestId('value')).toHaveTextContent('PayPayカード')
  })

  it('候補に無い値で開いた場合は、新規入力の状態でその値が入力欄に入る', () => {
    render(<Host initial="どこかの銀行" candidates={CANDIDATES} />)

    expect(screen.getByLabelText('金融機関名')).toHaveValue('__new__')
    expect(screen.getByLabelText('新しい金融機関名')).toHaveValue('どこかの銀行')
  })

  it('候補を選び直すと、新規入力欄は消える', () => {
    render(<Host initial="" candidates={CANDIDATES} />)
    fireEvent.change(screen.getByLabelText('金融機関名'), { target: { value: '__new__' } })

    fireEvent.change(screen.getByLabelText('金融機関名'), { target: { value: '楽天カード' } })

    expect(screen.queryByLabelText('新しい金融機関名')).not.toBeInTheDocument()
    expect(screen.getByTestId('value')).toHaveTextContent('楽天カード')
  })
})
