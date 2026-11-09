// @vitest-environment jsdom
/**
 * 全体の枠(AppShell)とサイドナビ・領域タブのテスト(計画Issue #150)。
 * 常設の左サイドナビ(仕訳・マスタ・明細取込・割勘・精算・分析、一番下に区切って設定)から1クリックで各領域へ
 * 移動でき、現在の領域が強調され、確認待ちの定期取引提案の件数が「仕訳」に表示されること、
 * 旧ハブ画面の入口が領域内のタブとして残ることを検証する。
 * 外部依存: react-routerのMemoryRouter(DB・Repositoryには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import i18n from '../../infrastructure/i18n/i18n'
import { useUnsavedChangesGuard } from '../common/unsaved-changes/unsavedChangesGuard'
import { AppShell } from './AppShell'

afterEach(cleanup)

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderShell(path: string, pendingProposalCount = 0) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell pendingProposalCount={pendingProposalCount} />}>
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

const nav = () => screen.getByRole('navigation', { name: 'メインメニュー' })

describe('AppShell', () => {
  it('サイドナビに仕訳・マスタ・明細取込・割勘・精算・分析・設定の順で並ぶ', () => {
    renderShell('/journal/entries')
    const labels = within(nav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(['仕訳', 'マスタ', '明細取込', '割勘・精算', '分析', '設定'])
  })

  it('「設定」は区切り線の後ろ(一番下)に置き、クリックすると設定画面へ移動して強調される(計画Issue #173)', () => {
    renderShell('/journal/entries')
    const settings = within(nav()).getByRole('link', { name: '設定' })
    expect(settings.previousElementSibling).toHaveClass('app-shell__nav-separator')
    fireEvent.click(settings)
    expect(screen.getByTestId('where')).toHaveTextContent('/settings')
    expect(within(nav()).getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page')
  })

  it('マスタ領域では左上にタイトル「マスタ」を見出しとして出し、他の領域では出さない', () => {
    renderShell('/master/accounts')
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1, name: 'マスタ' })).toBeInTheDocument()
    cleanup()
    renderShell('/journal/entries')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('サイドナビのリンクを1回クリックすると各領域の入口画面へ移動する', () => {
    renderShell('/journal/entries')
    fireEvent.click(within(nav()).getByRole('link', { name: '分析' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/reports/analysis')
    fireEvent.click(within(nav()).getByRole('link', { name: 'マスタ' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/master/accounts')
    fireEvent.click(within(nav()).getByRole('link', { name: '割勘・精算' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/splitting')
    fireEvent.click(within(nav()).getByRole('link', { name: '明細取込' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/create/import')
  })

  it('現在の領域のリンクだけがaria-current="page"になる(配下の画面でも維持される)', () => {
    renderShell('/journal/splitting')
    expect(within(nav()).getByRole('link', { name: '割勘・精算' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: '仕訳' })).not.toHaveAttribute('aria-current')
  })

  it('確認待ちの提案が1件以上あるときだけ「仕訳」に件数バッジを表示する', () => {
    renderShell('/journal/entries', 3)
    expect(within(nav()).getByRole('link', { name: /仕訳/ })).toHaveTextContent('3')
    cleanup()
    renderShell('/journal/entries', 0)
    expect(within(nav()).getByRole('link', { name: '仕訳' })).toHaveTextContent(/^仕訳$/)
  })

  it('割勘・精算の領域には領域のタブ帯を出さない(割勘と精算は画面内のタブ、計画Issue #153)', () => {
    renderShell('/journal/splitting')
    expect(screen.queryByRole('navigation', { name: '領域内のタブ' })).not.toBeInTheDocument()
  })

  it('マスタ領域のタブ帯に、勘定科目・取引先・世帯メンバー・プロジェクト・定期取引・明細マッピングの6つが並ぶ(計画Issue #154・#151)', () => {
    renderShell('/master/accounts')
    const tabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual([
      '勘定科目',
      '取引先',
      '世帯メンバー',
      'プロジェクト',
      '定期取引',
      '明細マッピング',
    ])
    expect(within(tabs).getByRole('link', { name: '勘定科目' })).toHaveAttribute('aria-current', 'page')
  })

  it('仕訳領域には領域タブ帯が無く(画面内のタブにした)、マスタ領域のタブ帯から定期取引のルールへ到達できる', () => {
    renderShell('/journal/entries')
    expect(screen.queryByRole('navigation', { name: '領域内のタブ' })).not.toBeInTheDocument()
    cleanup()
    renderShell('/master/recurring')
    const masterTabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(masterTabs).getByRole('link', { name: '定期取引' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'マスタ' })).toHaveAttribute('aria-current', 'page')
  })

  it('子の画面が未保存の変更のガードを登録していると、サイドナビ・領域タブのクリックを止めて確認に回し、続行で移動する', () => {
    let proceed: (() => void) | undefined
    function Guarding() {
      const guard = useUnsavedChangesGuard()
      useEffect(() => {
        guard.register((p) => {
          proceed = p
          return true
        })
        return () => guard.register(null)
      }, [guard])
      return <Where />
    }
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/master/accounts']}>
          <Routes>
            <Route element={<AppShell pendingProposalCount={0} />}>
              <Route path="*" element={<Guarding />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    )
    fireEvent.click(within(nav()).getByRole('link', { name: '分析' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/master/accounts')
    act(() => proceed?.())
    expect(screen.getByTestId('where')).toHaveTextContent('/reports/analysis')
    // 領域内のタブ(マスタ)も同じガードを通る
    cleanup()
    proceed = undefined
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/master/accounts']}>
          <Routes>
            <Route element={<AppShell pendingProposalCount={0} />}>
              <Route path="*" element={<Guarding />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    )
    fireEvent.click(within(screen.getByRole('navigation', { name: '領域内のタブ' })).getByRole('link', { name: '取引先' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/master/accounts')
    expect(proceed).toBeDefined()
  })

  it('子ルートの画面をmain内に表示する', () => {
    renderShell('/master/projects')
    expect(within(screen.getByRole('main')).getByTestId('where')).toHaveTextContent('/master/projects')
  })
})
