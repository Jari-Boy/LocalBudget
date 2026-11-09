// @vitest-environment jsdom
/**
 * 未保存の変更のガード(UnsavedChangesGuardProvider・GuardedLink・UnsavedChangesDialog)のテスト。
 * 画面が登録した「離れる前の確認」を、サイドナビ等のリンクが通ること、登録が無ければ素通しで
 * 移動すること、新しいタブで開く操作は止めないこと、ダイアログの3つの選択肢が呼び出し側へ
 * 伝わることを検証する。外部依存: react-routerのMemoryRouter(DB・Repositoryには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { GuardedLink, UnsavedChangesGuardProvider, useUnsavedChangesGuard } from './unsavedChangesGuard'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

afterEach(cleanup)

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function Registrar({ interceptor }: { interceptor: ((proceed: () => void) => boolean) | null }) {
  const guard = useUnsavedChangesGuard()
  useEffect(() => {
    guard.register(interceptor)
    return () => guard.register(null)
  }, [guard, interceptor])
  return null
}

function renderGuarded(interceptor: ((proceed: () => void) => boolean) | null) {
  render(
    <MemoryRouter initialEntries={['/a']}>
      <UnsavedChangesGuardProvider>
        <Registrar interceptor={interceptor} />
        <GuardedLink to="/b">b</GuardedLink>
        <Where />
      </UnsavedChangesGuardProvider>
    </MemoryRouter>,
  )
}

describe('GuardedLink', () => {
  it('ガードが登録されていなければ、そのまま移動する', () => {
    renderGuarded(null)
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
  })

  it('ガードが引き受けたときは移動せず、渡された続行関数を呼ぶと移動する', () => {
    let proceed: (() => void) | undefined
    renderGuarded((p) => {
      proceed = p
      return true
    })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
    act(() => proceed?.())
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
  })

  it('ガードが引き受けなかった(未保存の変更が無い)ときは、そのまま移動する', () => {
    renderGuarded(() => false)
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
  })

  it('Ctrlを押したクリック(新しいタブで開く操作)ではガードを呼ばない', () => {
    const interceptor = vi.fn(() => true)
    renderGuarded(interceptor)
    fireEvent.click(screen.getByRole('link', { name: 'b' }), { ctrlKey: true })
    expect(interceptor).not.toHaveBeenCalled()
  })
})

describe('UnsavedChangesDialog', () => {
  function renderDialog(saving = false) {
    const handlers = { onCancel: vi.fn(), onDiscard: vi.fn(), onSave: vi.fn() }
    render(<UnsavedChangesDialog saving={saving} {...handlers} />)
    return handlers
  }

  it('「未保存の変更」のダイアログに、キャンセル・破棄して移動・保存して移動の3つのボタンが並ぶ', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: '未保存の変更があります' })
    expect(dialog).toHaveTextContent('保存が完了していない変更があります')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['キャンセル', '破棄して移動', '保存して移動'])
  })

  it('各ボタンを押すと対応するコールバックが呼ばれる', () => {
    const { onCancel, onDiscard, onSave } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('保存中は、破棄と保存のボタンを押せない', () => {
    renderDialog(true)
    expect(screen.getByRole('button', { name: '破棄して移動' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存して移動' })).toBeDisabled()
  })
})
