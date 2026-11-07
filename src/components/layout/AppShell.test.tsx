// @vitest-environment jsdom
/**
 * 全体の枠(AppShell)とサイドナビ・領域タブのテスト(計画Issue #150)。
 * 常設の左サイドナビ(明細取込・仕訳・割勘・精算・マスタ・分析)から1クリックで各領域へ
 * 移動でき、現在の領域が強調され、確認待ちの定期取引提案の件数が「仕訳」に表示されること、
 * 旧ハブ画面の入口が領域内のタブとして残ることを検証する。
 * 外部依存: react-routerのMemoryRouter(DB・Repositoryには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import i18n from '../../infrastructure/i18n/i18n'
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
  it('サイドナビに5領域(明細取込・仕訳・割勘・精算・マスタ・分析)のリンクが並ぶ', () => {
    renderShell('/journal/entries')
    const labels = within(nav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(['明細取込', '仕訳', '割勘・精算', 'マスタ', '分析'])
  })

  it('サイドナビのリンクを1回クリックすると各領域の入口画面へ移動する', () => {
    renderShell('/journal/entries')
    fireEvent.click(within(nav()).getByRole('link', { name: '分析' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/reports/financial-statements')
    fireEvent.click(within(nav()).getByRole('link', { name: 'マスタ' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/master/accounts')
    fireEvent.click(within(nav()).getByRole('link', { name: '割勘・精算' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/splitting/new')
    fireEvent.click(within(nav()).getByRole('link', { name: '明細取込' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/create/import')
  })

  it('現在の領域のリンクだけがaria-current="page"になる(配下の画面でも維持される)', () => {
    renderShell('/journal/splitting/history')
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

  it('領域のタブ帯に旧ハブの入口が並び、現在のタブがaria-current="page"になる', () => {
    renderShell('/journal/splitting/settlement')
    const tabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual([
      '割勘する',
      '精算',
      '割勘の履歴',
    ])
    expect(within(tabs).getByRole('link', { name: '精算' })).toHaveAttribute('aria-current', 'page')
  })

  it('マスタ領域のタブ帯に、勘定科目・取引先・世帯メンバー・プロジェクト・定期取引の5つが並ぶ(計画Issue #154)', () => {
    renderShell('/master/accounts')
    const tabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual([
      '勘定科目',
      '取引先',
      '世帯メンバー',
      'プロジェクト',
      '定期取引',
    ])
    expect(within(tabs).getByRole('link', { name: '勘定科目' })).toHaveAttribute('aria-current', 'page')
  })

  it('仕訳領域のタブ帯から定期取引の提案へ、マスタ領域のタブ帯から定期取引のルールへ到達できる', () => {
    renderShell('/journal/recurring/proposals')
    const journalTabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(journalTabs).getByRole('link', { name: '定期取引の確認' })).toHaveAttribute('href', '/journal/recurring/proposals')
    cleanup()
    renderShell('/master/recurring')
    const masterTabs = screen.getByRole('navigation', { name: '領域内のタブ' })
    expect(within(masterTabs).getByRole('link', { name: '定期取引' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'マスタ' })).toHaveAttribute('aria-current', 'page')
  })

  it('子ルートの画面をmain内に表示する', () => {
    renderShell('/master/projects')
    expect(within(screen.getByRole('main')).getByTestId('where')).toHaveTextContent('/master/projects')
  })
})
