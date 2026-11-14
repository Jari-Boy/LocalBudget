import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import { GuardedLink, UnsavedChangesGuardProvider } from '../common/unsaved-changes/unsavedChangesGuard'
import { AREAS, findActiveTab, findArea } from './areas'
import './AppShell.css'
import './sticky-side-panel.css'

export interface AppShellProps {
  /** 承認待ちの定期仕訳提案の件数。1件以上のとき「仕訳」に表示する。 */
  pendingProposalCount: number
}

/**
 * 全体の枠(計画Issue #150)。常設の左サイドナビと、領域内のタブ帯、子ルートの表示領域を持つ。
 * ホーム画面と中継(ハブ)画面をなくし、5領域へ1クリックで移動できるようにする。設定(計画Issue #173)は
 * 区切り線の後ろ、サイドナビの一番下に置く。
 * 現在の領域は配下の画面(詳細・フォーム等)でも強調したままにするため、Linkの
 * 既定の一致判定ではなくareas.tsのprefixesで判定する。
 * 画面が未保存の変更を持つときの確認は、移動のリンク(GuardedLink)が通す(HashRouterはuseBlockerを使えない)。
 */
export function AppShell({ pendingProposalCount }: AppShellProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const currentArea = findArea(pathname)
  const activeTab = currentArea ? findActiveTab(currentArea, pathname) : undefined

  return (
    <UnsavedChangesGuardProvider>
      <div className="app-shell">
        <nav className="app-shell__nav" aria-label={t('nav.mainMenu')}>
          <div className="app-shell__brand">{t('appName')}</div>
          {AREAS.map((area) => {
            const isCurrent = currentArea?.key === area.key
            const badge = area.key === 'journal' && pendingProposalCount > 0 ? pendingProposalCount : null
            return (
              <Fragment key={area.key}>
                {area.separated && <div className="app-shell__nav-separator" aria-hidden="true" />}
                <GuardedLink
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
                </GuardedLink>
              </Fragment>
            )
          })}
        </nav>
        <main className="app-shell__main">
          {/* 他の領域は各画面が見出しを持つ。マスタはタブごとの画面なので、枠がタイトルを出す */}
          {currentArea?.key === 'master' && <h1 className="app-shell__title">{t('nav.master')}</h1>}
          {currentArea && currentArea.tabs.length > 0 && (
            <nav className="app-shell__tabs" aria-label={t('nav.areaTabs')}>
              {currentArea.tabs.map((tab) => (
                <GuardedLink
                  key={tab.to}
                  to={tab.to}
                  className={`app-shell__tab${tab === activeTab ? ' app-shell__tab--current' : ''}`}
                  aria-current={tab === activeTab ? 'page' : undefined}
                >
                  {t(`nav.tab.${tab.labelKey}`)}
                </GuardedLink>
              ))}
            </nav>
          )}
          <Outlet />
        </main>
      </div>
    </UnsavedChangesGuardProvider>
  )
}
