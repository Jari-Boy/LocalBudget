// @vitest-environment jsdom
/**
 * 起動時の保存先ゲート(StorageGate)と「フォルダに再接続」画面のテスト(計画Issue #174)。
 * 保存先がそのまま開けるなら子要素(アプリ本体)を出し、フォルダの権限が「確認が必要」に戻って
 * いるときはDBを開かずに再接続画面を出す。再接続ボタンで権限が得られれば子要素へ進み、得られなければ
 * 理由を示して画面に留まる。フォルダのハンドルが無いときは再接続できないため、ブラウザ内に戻す導線だけを出す。
 * ブラウザ内に戻すときは確認ダイアログを経て、保存先の選択を戻して再読み込みする。
 * 外部依存: なし。保存先の判定・権限の再要求・戻す処理・再読み込みは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { StartupStorage } from '../../infrastructure/storage/resolveStartupStorage'
import { StorageGate } from './StorageGate'

afterEach(cleanup)

const HANDLE = { name: '家計簿' } as FileSystemDirectoryHandle

function setup(startup: StartupStorage, options: { reconnect?: () => Promise<boolean> } = {}) {
  const reconnect = vi.fn(options.reconnect ?? (async () => true))
  const revertToIndexedDb = vi.fn(async () => {})
  const reload = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <StorageGate
        resolve={async () => startup}
        reconnect={reconnect}
        revertToIndexedDb={revertToIndexedDb}
        reload={reload}
      >
        <p>アプリ本体</p>
      </StorageGate>
    </I18nextProvider>,
  )
  return { reconnect, revertToIndexedDb, reload }
}

describe('StorageGate', () => {
  it('保存先がそのまま開けるなら、子要素を表示する', async () => {
    setup({ kind: 'ready' })
    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
  })

  it('再接続が必要なら、子要素は出さずフォルダ名を示した再接続画面を表示する', async () => {
    setup({ kind: 'needs-reconnect', folderName: '家計簿', handle: HANDLE })
    expect(await screen.findByRole('heading', { name: 'フォルダに再接続してください' })).toBeInTheDocument()
    expect(screen.getByText('家計簿')).toBeInTheDocument()
    expect(screen.queryByText('アプリ本体')).not.toBeInTheDocument()
  })

  it('再接続ボタンで権限が得られたら、子要素へ進む', async () => {
    const { reconnect } = setup({ kind: 'needs-reconnect', folderName: '家計簿', handle: HANDLE })
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダに再接続する' }))
    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
    expect(reconnect).toHaveBeenCalledWith(HANDLE)
  })

  it('権限が得られなかったら、許可されなかったことを示して再接続画面に留まる', async () => {
    setup({ kind: 'needs-reconnect', folderName: '家計簿', handle: HANDLE }, { reconnect: async () => false })
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダに再接続する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('許可されませんでした')
    expect(screen.queryByText('アプリ本体')).not.toBeInTheDocument()
  })

  it('ハンドルが無いときは再接続ボタンを出さず、ブラウザ内に戻す導線だけを出す', async () => {
    setup({ kind: 'needs-reconnect', folderName: null, handle: null })
    expect(await screen.findByText(/見つかりません/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'フォルダに再接続する' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ブラウザ内のデータに戻す…' })).toBeInTheDocument()
  })

  it('ブラウザ内に戻すは確認ダイアログを経て、確定すると保存先を戻して再読み込みする', async () => {
    const { revertToIndexedDb, reload } = setup({ kind: 'needs-reconnect', folderName: '家計簿', handle: HANDLE })
    fireEvent.click(await screen.findByRole('button', { name: 'ブラウザ内のデータに戻す…' }))
    const dialog = screen.getByRole('dialog')
    expect(revertToIndexedDb).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'ブラウザ内に戻す' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(revertToIndexedDb).toHaveBeenCalled()
  })

  it('確認ダイアログでキャンセルすると、何も変えずに閉じる', async () => {
    const { revertToIndexedDb, reload } = setup({ kind: 'needs-reconnect', folderName: '家計簿', handle: HANDLE })
    fireEvent.click(await screen.findByRole('button', { name: 'ブラウザ内のデータに戻す…' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(revertToIndexedDb).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
