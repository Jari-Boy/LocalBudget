// @vitest-environment jsdom
/**
 * 設定画面(SettingsScreen)のテスト(計画Issue #173)。データの保存先の表示、バックアップの
 * 書き出し(エクスポート)と読み込み(インポート)の操作を検証する。読み込みは、ファイルを選ぶと
 * 確認ダイアログ(ファイル名・サイズ・更新日時、今のデータの書き出し)を出し、置き換えを選ぶと
 * 読み込み中の表示を経て、成功ならお知らせの印を残してページを再読み込みする。読み込めない
 * ファイル(InvalidBackupFileError)なら、データを変えていないことを伝えるダイアログを出す。
 * 外部依存: なし。Worker側のバックアップAPI・ダウンロード・再読み込み・sessionStorageは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidBackupFileError } from '../../infrastructure/backup/InvalidBackupFileError'
import i18n from '../../infrastructure/i18n/i18n'
import { markImportCompleted, takeImportNotice, type NoticeStorage } from './importNotice'
import { SettingsScreen, type BackupApi } from './SettingsScreen'

afterEach(cleanup)

function createMemoryStorage(): NoticeStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

const EXPORTED = new Uint8Array([1, 2, 3])

function setup(options: { backup?: Partial<BackupApi>; noticeStorage?: NoticeStorage } = {}) {
  const backup: BackupApi = {
    export: vi.fn(async () => EXPORTED),
    importDatabase: vi.fn(async () => {}),
    ...options.backup,
  }
  const download = vi.fn()
  const reload = vi.fn()
  const noticeStorage = options.noticeStorage ?? createMemoryStorage()
  const view = render(
    <I18nextProvider i18n={i18n}>
      <SettingsScreen
        backup={backup}
        storage={{
          getStatus: async () => ({ kind: 'indexeddb', folderName: null, writable: true, externalChange: false }),
          moveToFolder: async () => {},
          moveToIndexedDb: async () => {},
        }}
        folderPicker={{ isSupported: true, pick: async () => null, describe: async () => null }}
        download={download}
        reload={reload}
        noticeStorage={noticeStorage}
        now={() => new Date(2026, 10, 10, 9, 30)}
      />
    </I18nextProvider>,
  )
  return { backup, download, reload, noticeStorage, container: view.container }
}

function backupFile(bytes = new Uint8Array(2048)) {
  return new File([bytes], 'local-budget-backup-20261108-2114.sqlite', {
    lastModified: new Date(2026, 10, 8, 21, 14).getTime(),
  })
}

function chooseFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not found')
  fireEvent.change(input, { target: { files: [file] } })
}

const dialog = () => screen.getByRole('dialog')

describe('SettingsScreen', () => {
  it('見出し「設定」と、データの保存先が「このブラウザ内」であることを表示する', async () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument()
    const storage = screen.getByRole('region', { name: 'データの保存先' })
    expect(await within(storage).findByText('このブラウザ内')).toBeInTheDocument()
  })

  it('「書き出す」を押すと、Workerから受け取ったDBを日時入りのファイル名でダウンロードさせる', async () => {
    const { backup, download } = setup()
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(EXPORTED, 'local-budget-backup-20261110-0930.sqlite'))
    expect(backup.export).toHaveBeenCalledTimes(1)
  })

  it('書き出しに失敗すると、書き出せなかったことを表示する', async () => {
    const { download } = setup({ backup: { export: vi.fn(async () => Promise.reject(new Error('boom'))) } })
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('書き出せませんでした')
    expect(download).not.toHaveBeenCalled()
  })

  it('ファイルを選ぶと、ファイル名・サイズ・更新日時と置き換えの注意を示す確認ダイアログを出す', async () => {
    const { container, backup } = setup()
    chooseFile(container, backupFile())
    const d = await screen.findByRole('dialog', { name: 'バックアップから読み込みます' })
    expect(within(d).getByText('local-budget-backup-20261108-2114.sqlite')).toBeInTheDocument()
    expect(within(d).getByText('2 KB')).toBeInTheDocument()
    expect(within(d).getByText('2026/11/08 21:14')).toBeInTheDocument()
    expect(d).toHaveTextContent('元に戻せません')
    expect(backup.importDatabase).not.toHaveBeenCalled()
  })

  it('確認ダイアログでキャンセルすると、読み込まずにダイアログを閉じる', async () => {
    const { container, backup, reload } = setup()
    chooseFile(container, backupFile())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backup.importDatabase).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('確認ダイアログの「今のデータを書き出す」は、ダイアログを開いたまま今のデータをダウンロードさせる', async () => {
    const { container, download } = setup()
    chooseFile(container, backupFile())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '今のデータを書き出す' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(EXPORTED, 'local-budget-backup-20261110-0930.sqlite'))
    expect(dialog()).toBeInTheDocument()
  })

  it('「置き換えて読み込む」を押すと、ファイルのバイト列を読み込ませ、お知らせの印を残してページを再読み込みする', async () => {
    const { container, backup, reload, noticeStorage } = setup()
    const bytes = new Uint8Array([9, 8, 7])
    chooseFile(container, backupFile(bytes))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '置き換えて読み込む' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(backup.importDatabase).toHaveBeenCalledWith(bytes)
    expect(takeImportNotice(noticeStorage)).toBe('local-budget-backup-20261108-2114.sqlite')
  })

  it('読み込み中は「読み込んでいます」と表示し、キャンセル・読み込みのボタンを押せなくする', async () => {
    let finish: () => void = () => {}
    const { container } = setup({
      backup: { importDatabase: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) },
    })
    chooseFile(container, backupFile())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '置き換えて読み込む' }))
    const d = await screen.findByRole('dialog', { name: '読み込んでいます…' })
    expect(within(d).getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    expect(within(d).getByRole('button', { name: '置き換えて読み込む' })).toBeDisabled()
    await act(async () => finish())
  })

  it('読み込めないファイル(InvalidBackupFileError)なら、データを変えていないことを伝え、再読み込みも印もしない', async () => {
    const { container, reload, noticeStorage } = setup({
      backup: { importDatabase: vi.fn(async () => Promise.reject(new InvalidBackupFileError('bad'))) },
    })
    chooseFile(container, backupFile())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '置き換えて読み込む' }))
    const d = await screen.findByRole('alertdialog', { name: 'このファイルは読み込めません' })
    expect(d).toHaveTextContent('local-budget-backup-20261108-2114.sqlite')
    expect(d).toHaveTextContent('今のデータは変更していません')
    expect(reload).not.toHaveBeenCalled()
    expect(takeImportNotice(noticeStorage)).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('それ以外の理由で読み込みに失敗したら、ページを読み込み直してから再度試すよう伝え、再読み込みはしない', async () => {
    const { container, reload } = setup({
      backup: { importDatabase: vi.fn(async () => Promise.reject(new Error('quota exceeded'))) },
    })
    chooseFile(container, backupFile())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '置き換えて読み込む' }))
    const d = await screen.findByRole('alertdialog', { name: '読み込みに失敗しました' })
    expect(d).toHaveTextContent('ページを読み込み直してから')
    expect(reload).not.toHaveBeenCalled()
  })

  it('読み込み後の再読み込みで印が残っていれば、読み込んだファイル名とともに完了を知らせ、閉じられる', () => {
    const noticeStorage = createMemoryStorage()
    markImportCompleted('local-budget-backup-20261108-2114.sqlite', noticeStorage)
    setup({ noticeStorage })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('バックアップから読み込みました(local-budget-backup-20261108-2114.sqlite)')
    fireEvent.click(within(status).getByRole('button', { name: 'お知らせを閉じる' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('印がなければ完了のお知らせは出さない', () => {
    setup()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
