import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router'
import { AREAS, findActiveTab, findArea } from './areas'
import './AppShell.css'

export interface AppShellProps {
  /** 確認待ちの定期取引提案の件数。1件以上のとき「仕訳」に表示する。 */
  pendingProposalCount: number
}

/**
 * 全体の枠(計画Issue #150)。常設の左サイドナビと、領域内のタブ帯、子ルートの表示領域を持つ。
 * ホーム画面と中継(ハブ)画面をなくし、5領域へ1クリックで移動できるようにする。
 * 現在の領域は配下の画面(詳細・フォーム等)でも強調したままにするため、Linkの
 * 既定の一致判定ではなくareas.tsのprefixesで判定する。
 */
export function AppShell({ pendingProposalCount }: AppShellProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const currentArea = findArea(pathname)
  const activeTab = currentArea ? findActiveTab(currentArea, pathname) : undefined

  return (
    <div className="app-shell">
      <nav className="app-shell__nav" aria-label={t('nav.mainMenu')}>
        <div className="app-shell__brand">{t('appName')}</div>
        {AREAS.map((area) => {
          const isCurrent = currentArea?.key === area.key
          const badge = area.key === 'journal' && pendingProposalCount > 0 ? pendingProposalCount : null
          return (
            <Link
              key={area.key}
              to={area.to}
              className={`app-shell__nav-item${isCurrent ? ' app-shell__nav-item--current' : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <span>{t(`nav.${area.key}`)}</span>
              {badge !== null && (
                <span className="app-shell__badge" title={t('nav.pendingProposals', { count: badge })}>
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <main className="app-shell__main">
        {currentArea && currentArea.tabs.length > 0 && (
          <nav className="app-shell__tabs" aria-label={t('nav.areaTabs')}>
            {currentArea.tabs.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={`app-shell__tab${tab === activeTab ? ' app-shell__tab--current' : ''}`}
                aria-current={tab === activeTab ? 'page' : undefined}
              >
                {t(`nav.tab.${tab.labelKey}`)}
              </Link>
            ))}
          </nav>
        )}
        <Outlet />
      </main>
    </div>
  )
}
