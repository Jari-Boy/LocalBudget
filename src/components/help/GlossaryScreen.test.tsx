// @vitest-environment jsdom
/**
 * 用語集画面(GlossaryScreen)のテスト(計画Issue #177、承認済みモックアップ④)。
 * LocalBudget特有の用語を区分のタブ(人・相手/科目・口座/記帳・取込/割勘・精算/保存・バックアップ)に分けて出し、
 * 検索語があるときは全区分から探す。「すべて」のタブは無い。精算バッチの項目には、例と流れの詳細(旅行代を
 * 友人と折半する例)を開くリンクがあり、流れのボタンで仕訳の表と残高の表が切り替わる。
 * 外部依存: なし(DB・Repositoryには依存しない。文言は本物の辞書から出す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { GlossaryScreen } from './GlossaryScreen'

afterEach(cleanup)

function setup() {
  render(
    <I18nextProvider i18n={i18n}>
      <GlossaryScreen />
    </I18nextProvider>,
  )
}

/** 用語の見出し(「用語名 区分のタグ」)。「世帯メンバー」が「世帯メンバーのグループ」に一致しないよう、用語名の直後の空白まで見る */
const termHeading = (name: string) => screen.queryByRole('heading', { level: 3, name: new RegExp(`^${name}\\s`) })

describe('GlossaryScreen', () => {
  it('最初は「人・相手」の用語を出し、ほかの区分の用語は出さない', () => {
    setup()

    expect(termHeading('世帯メンバー')).toBeInTheDocument()
    expect(termHeading('取引先')).toBeInTheDocument()
    expect(termHeading('勘定科目')).not.toBeInTheDocument()
  })

  it('区分のタブは5つで、「すべて」のタブは無い', () => {
    setup()

    const tabs = within(screen.getByRole('group', { name: '区分で切り替え' })).getAllByRole('button')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['人・相手', '科目・口座', '記帳・取込', '割勘・精算', '保存・バックアップ'])
  })

  it('区分のタブを押すと、その区分の用語に切り替わる', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '科目・口座' }))

    expect(termHeading('勘定科目')).toBeInTheDocument()
    expect(termHeading('システム管理科目')).toBeInTheDocument()
    expect(termHeading('世帯メンバー')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '科目・口座' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('検索語を入れると、選んだ区分に関わらず全区分から探し、件数を示す', () => {
    setup()

    fireEvent.change(screen.getByRole('searchbox', { name: '用語を検索' }), { target: { value: '精算バッチ' } })

    expect(termHeading('精算バッチ')).toBeInTheDocument()
    expect(termHeading('世帯メンバー')).not.toBeInTheDocument()
    expect(screen.getByText(/全区分から検索/)).toBeInTheDocument()
  })

  it('一致する用語が無いときは、別の言葉で検索するよう案内する', () => {
    setup()

    fireEvent.change(screen.getByRole('searchbox', { name: '用語を検索' }), { target: { value: 'あいうえおかきくけこ' } })

    expect(screen.getByText('該当する用語がありません。別の言葉で検索してください。')).toBeInTheDocument()
  })

  it('簿記での言い換えがある用語には「簿記では:」の行を出し、無い用語には出さない', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '割勘・精算' }))

    const batch = termHeading('精算バッチ')!.closest('article')!
    expect(within(batch).getByText(/簿記では:/)).toBeInTheDocument()
    const split = termHeading('割勘')!.closest('article')!
    expect(within(split).queryByText(/簿記では:/)).not.toBeInTheDocument()
  })

  it('精算バッチの「例と流れを詳しく見る」で、旅行代を折半する例の詳細が開く', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '割勘・精算' }))
    const details = screen.getByTestId('batch-detail') as HTMLDetailsElement
    expect(details.open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '例と流れを詳しく見る' }))

    expect(details.open).toBe(true)
  })

  it('流れのボタンを押すと、その段階の仕訳の表と、バッチの残高の表が切り替わる', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '割勘・精算' }))
    fireEvent.click(screen.getByRole('button', { name: '例と流れを詳しく見る' }))

    const balance = () => within(screen.getByTestId('batch-balance'))
    expect(balance().getByText('15,000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /③ 結びつけて完了/ }))

    expect(balance().getByText('0')).toBeInTheDocument()
    expect(screen.getByText('精算済み')).toBeInTheDocument()
  })
})
