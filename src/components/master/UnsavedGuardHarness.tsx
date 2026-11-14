import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { GuardedLink, UnsavedChangesGuardProvider } from '../common/unsaved-changes/unsavedChangesGuard'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

/**
 * マスタの各タブの「未保存の編集の警告」(計画Issue #190)のテスト用の枠。実際のアプリと同じく、
 * ガードのプロバイダの中にタブを置き、サイドナビの代わりになる移動のリンク(GuardedLink)と、
 * 現在のパスの表示(data-testid="where")を添える。テスト専用で、アプリ本体からは使わない。
 */
export function UnsavedGuardHarness({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/master/here']}>
      <UnsavedChangesGuardProvider>
        <GuardedLink to="/other">他の画面へ</GuardedLink>
        <Where />
        {children}
      </UnsavedChangesGuardProvider>
    </MemoryRouter>
  )
}
