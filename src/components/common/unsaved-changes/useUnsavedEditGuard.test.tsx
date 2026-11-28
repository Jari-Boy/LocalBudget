// @vitest-environment jsdom
/**
 * 未保存の編集のガード(useUnsavedEditGuard・useGuardedAction、計画Issue #190)のテスト。
 * マスタの各タブの編集パネルが「未保存か」と「保存の実行」を渡すと、サイドナビ等のリンクと
 * 画面内の操作(行の選択など)が、保存して移動・破棄して移動・キャンセルの確認を通ること、
 * 保存に失敗したときは移動しないこと、設定が「出さない」のときは確認もリロードの警告も出ないことを検証する。
 * 外部依存: react-routerのMemoryRouter(DB・Repositoryには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { GuardedLink, UnsavedChangesGuardProvider } from './unsavedChangesGuard'
import { saveUnsavedWarningEnabled } from './unsavedWarningSetting'
import { useGuardedAction, useUnsavedEditGuard } from './useUnsavedEditGuard'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function Panel({
  dirty,
  save,
  description,
  extraAction,
}: {
  dirty: boolean
  save?: () => Promise<boolean>
  description?: string
  extraAction?: { label: string; run: () => Promise<boolean> }
}) {
  const dialog = useUnsavedEditGuard({ dirty, save, description, extraAction })
  return <>{dialog}</>
}

function Row({ onSelect }: { onSelect: () => void }) {
  const guarded = useGuardedAction()
  return (
    <button type="button" onClick={() => guarded(onSelect)}>
      行
    </button>
  )
}

function renderScreen(props: {
  dirty: boolean
  save?: () => Promise<boolean>
  /** trueなら、saveを渡さない(「保存して移動」を出さない) */
  withoutSave?: boolean
  onSelect?: () => void
  description?: string
  extraAction?: { label: string; run: () => Promise<boolean> }
}) {
  const save = props.withoutSave ? undefined : (props.save ?? (async () => true))
  const onSelect = props.onSelect ?? (() => {})
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <UnsavedChangesGuardProvider>
        <Panel dirty={props.dirty} save={save} description={props.description} extraAction={props.extraAction} />
        <Row onSelect={onSelect} />
        <GuardedLink to="/b">b</GuardedLink>
        <Where />
      </UnsavedChangesGuardProvider>
    </MemoryRouter>,
  )
}

describe('useUnsavedEditGuard', () => {
  it('未保存でなければ、リンクはそのまま移動し、ダイアログは出ない', () => {
    renderScreen({ dirty: false })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('未保存のとき、リンクを押すと移動せず確認ダイアログが出る', () => {
    renderScreen({ dirty: true })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
    expect(screen.getByRole('dialog', { name: '未保存の変更があります' })).toBeInTheDocument()
  })

  it('キャンセルでは移動せず、ダイアログが閉じる', () => {
    renderScreen({ dirty: true })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('破棄して移動を選ぶと、保存せずに移動する', () => {
    const save = vi.fn(async () => true)
    renderScreen({ dirty: true, save })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
  })

  it('保存して移動を選ぶと、保存に成功したあとで移動する', async () => {
    const save = vi.fn(async () => true)
    renderScreen({ dirty: true, save })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/b'))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('保存に失敗したときは移動せず、ダイアログを閉じて編集に戻る', async () => {
    const save = vi.fn(async () => false)
    renderScreen({ dirty: true, save })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
  })

  it('保存が例外を投げたときも、移動せずダイアログを閉じる', async () => {
    renderScreen({
      dirty: true,
      save: async () => {
        throw new Error('boom')
      },
    })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
  })

  it('設定が「出さない」のときは、未保存でも確認なしで移動する', () => {
    saveUnsavedWarningEnabled(false)
    renderScreen({ dirty: true })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/b')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('未保存のとき、リロード・タブを閉じる操作の警告(beforeunload)が登録され、未保存でなければ登録されない', () => {
    const { rerender } = renderScreen({ dirty: true })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    rerender(
      <MemoryRouter>
        <UnsavedChangesGuardProvider>
          <Panel dirty={false} save={async () => true} />
        </UnsavedChangesGuardProvider>
      </MemoryRouter>,
    )
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('設定が「出さない」のときは、リロードの警告も登録されない', () => {
    saveUnsavedWarningEnabled(false)
    renderScreen({ dirty: true })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('useGuardedAction(画面内の操作)', () => {
  it('未保存でなければ、操作はすぐに実行される', () => {
    const onSelect = vi.fn()
    renderScreen({ dirty: false, onSelect })
    fireEvent.click(screen.getByRole('button', { name: '行' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('未保存のとき、操作は確認が済むまで実行されず、キャンセルでは実行されない', () => {
    const onSelect = vi.fn()
    renderScreen({ dirty: true, onSelect })
    fireEvent.click(screen.getByRole('button', { name: '行' }))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('未保存のとき、破棄して移動を選ぶと操作が実行される', () => {
    const onSelect = vi.fn()
    renderScreen({ dirty: true, onSelect })
    fireEvent.click(screen.getByRole('button', { name: '行' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('保護の対象の画面が無い(ガードの外)ときも、操作はそのまま実行される', () => {
    const onSelect = vi.fn()
    render(<Row onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: '行' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('useUnsavedEditGuard: 説明文と追加の保存操作(計画Issue #231 フェーズ3)', () => {
  it('追加の操作を渡さないときは、これまでどおり3つのボタン(キャンセル・破棄して移動・保存して移動)だけを出す', () => {
    renderScreen({ dirty: true })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['キャンセル', '破棄して移動', '保存して移動', '行'])
  })

  it('説明文を渡すと、既定の文言のあとに出す', () => {
    renderScreen({ dirty: true, description: '入力済みの1件を確定します。' })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    expect(screen.getByText('保存が完了していない変更があります。')).toBeInTheDocument()
    expect(screen.getByText('入力済みの1件を確定します。')).toBeInTheDocument()
  })

  it('追加の操作を渡すと、「破棄して移動」と「保存して移動」の間にそのボタンを出し、押すとその操作を実行して、成功したら移動する', async () => {
    const run = vi.fn(async () => true)
    const save = vi.fn(async () => true)
    renderScreen({ dirty: true, save, extraAction: { label: '一時保存して移動', run } })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['キャンセル', '破棄して移動', '一時保存して移動', '保存して移動', '行'])
    fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/b'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('追加の操作が失敗(false)したときは、移動せずダイアログを閉じる', async () => {
    renderScreen({ dirty: true, extraAction: { label: '一時保存して移動', run: async () => false } })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
  })

  it('追加の操作が例外を投げたときも、移動せずダイアログを閉じる', async () => {
    renderScreen({
      dirty: true,
      extraAction: {
        label: '一時保存して移動',
        run: async () => {
          throw new Error('保存に失敗')
        },
      },
    })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/a')
  })

  it('保存の操作(save)を渡さないときは、「保存して移動」を出さず、追加の操作だけを保存の操作として出す(計画Issue #293)', async () => {
    const run = vi.fn(async () => true)
    renderScreen({ dirty: true, withoutSave: true, extraAction: { label: '一時保存して移動', run } })
    fireEvent.click(screen.getByRole('link', { name: 'b' }))

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['キャンセル', '破棄して移動', '一時保存して移動', '行'])
    fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/b'))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
