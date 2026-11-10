// @vitest-environment jsdom
/**
 * 設定画面の「データの保存先」欄(StorageSection)のテスト(計画Issue #174)。現在の保存先(ブラウザ内/
 * フォルダ名)の表示、フォルダへの切り替え(空のフォルダなら今のデータを移す、既存ファイルがあれば
 * 「開く/上書き」を選ばせる、開けないファイルなら理由を示して変えない)、ブラウザ内へ戻す(フォルダの
 * 最新をコピー/ブラウザ内の古いデータのまま)、フォルダ選択に非対応の環境での無効化と案内、
 * 書き込みの権利が無い(2つ目の)タブでの無効化を検証する。成功後はページを再読み込みする。
 * 外部依存: なし。Worker側の保存先API・フォルダ選択・再読み込みは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidBackupFileError } from '../../infrastructure/backup/InvalidBackupFileError'
import i18n from '../../infrastructure/i18n/i18n'
import type { StorageStatus } from '../../infrastructure/rpc/createStorageApi'
import type { FolderDatabaseInfo } from '../../infrastructure/storage/describeFolderDatabase'
import { StorageSection, type FolderPicker, type StorageApi } from './StorageSection'

afterEach(cleanup)

const HANDLE = { name: '家計簿(OneDrive)' } as FileSystemDirectoryHandle
const EXISTING: FolderDatabaseInfo = { size: 412 * 1024, lastModified: new Date(2026, 10, 8, 21, 14).getTime() }

const BROWSER: StorageStatus = { kind: 'indexeddb', folderName: null, writable: true }
const FOLDER: StorageStatus = { kind: 'folder', folderName: '家計簿(OneDrive)', writable: true }

function setup(
  options: {
    status?: StorageStatus
    storage?: Partial<StorageApi>
    picker?: Partial<FolderPicker>
  } = {},
) {
  const storage: StorageApi = {
    getStatus: vi.fn(async () => options.status ?? BROWSER),
    moveToFolder: vi.fn(async () => {}),
    moveToIndexedDb: vi.fn(async () => {}),
    ...options.storage,
  }
  const folderPicker: FolderPicker = {
    isSupported: true,
    pick: vi.fn(async () => HANDLE),
    describe: vi.fn(async () => null),
    ...options.picker,
  }
  const reload = vi.fn()
  const exportCurrent = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <StorageSection storage={storage} folderPicker={folderPicker} exportCurrent={exportCurrent} reload={reload} />
    </I18nextProvider>,
  )
  return { storage, folderPicker, reload, exportCurrent }
}

const region = () => screen.getByRole('region', { name: 'データの保存先' })

describe('StorageSection', () => {
  describe('現在の保存先の表示', () => {
    it('ブラウザ内なら「このブラウザ内」と、フォルダに保存する欄を表示する', async () => {
      setup()
      expect(await within(region()).findByText('このブラウザ内')).toBeInTheDocument()
      expect(within(region()).getByRole('button', { name: 'フォルダを選ぶ…' })).toBeEnabled()
    })

    it('フォルダなら「フォルダ」とフォルダ名・ファイル名・接続中を表示する', async () => {
      setup({ status: FOLDER })
      expect(await within(region()).findByText('家計簿(OneDrive)')).toBeInTheDocument()
      expect(region()).toHaveTextContent('local-budget.sqlite')
      expect(region()).toHaveTextContent('接続中')
      expect(within(region()).getByRole('button', { name: 'ブラウザ内に戻す…' })).toBeInTheDocument()
    })
  })

  describe('フォルダ選択に非対応の環境', () => {
    it('ボタンを無効にし、理由とバックアップの案内を表示する', async () => {
      const { folderPicker } = setup({ picker: { isSupported: false } })
      const button = await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' })
      expect(button).toBeDisabled()
      expect(region()).toHaveTextContent('お使いのブラウザは、フォルダへの保存に対応していません')
      expect(region()).toHaveTextContent('バックアップ')
      expect(folderPicker.pick).not.toHaveBeenCalled()
    })
  })

  describe('書き込みの権利が無いタブ', () => {
    it('保存先を変える操作を無効にし、別のタブで開いていることを伝える', async () => {
      setup({ status: { ...FOLDER, writable: false } })
      expect(await within(region()).findByText(/別のタブ/)).toBeInTheDocument()
      expect(within(region()).getByRole('button', { name: 'フォルダを選ぶ…' })).toBeDisabled()
      expect(within(region()).getByRole('button', { name: 'ブラウザ内に戻す…' })).toBeDisabled()
    })
  })

  describe('フォルダへの切り替え', () => {
    it('フォルダにDBファイルが無ければ、確認なしで今のデータを移して再読み込みする', async () => {
      const { storage, reload } = setup()
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))

      await waitFor(() => expect(reload).toHaveBeenCalled())
      expect(storage.moveToFolder).toHaveBeenCalledWith(HANDLE, 'copy')
    })

    it('フォルダ選択をキャンセルしたら(nullが返る)、何もしない', async () => {
      const { storage, reload } = setup({ picker: { pick: vi.fn(async () => null) } })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(storage.moveToFolder).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })

    it('既存のDBファイルがあれば、サイズと更新日時を示した選択ダイアログを出し、まだ何も変えない', async () => {
      const { storage } = setup({ picker: { describe: vi.fn(async () => EXISTING) } })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))

      const d = await screen.findByRole('dialog', { name: 'このフォルダには、すでにデータがあります' })
      expect(d).toHaveTextContent('家計簿(OneDrive)')
      expect(d).toHaveTextContent('412 KB')
      expect(d).toHaveTextContent('2026/11/08 21:14')
      expect(storage.moveToFolder).not.toHaveBeenCalled()
    })

    it('既存ファイルを「開く」(既定)で進むと、フォルダのファイルを開いて再読み込みする', async () => {
      const { storage, reload } = setup({ picker: { describe: vi.fn(async () => EXISTING) } })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))
      const d = await screen.findByRole('dialog')

      fireEvent.click(within(d).getByRole('button', { name: 'この内容で進む' }))

      await waitFor(() => expect(reload).toHaveBeenCalled())
      expect(storage.moveToFolder).toHaveBeenCalledWith(HANDLE, 'open')
    })

    it('既存ファイルを「上書き」で進むと、今のデータで置き換えて再読み込みする', async () => {
      const { storage, reload } = setup({ picker: { describe: vi.fn(async () => EXISTING) } })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))
      const d = await screen.findByRole('dialog')

      fireEvent.click(within(d).getByRole('radio', { name: /今のデータで上書きする/ }))
      fireEvent.click(within(d).getByRole('button', { name: 'この内容で進む' }))

      await waitFor(() => expect(reload).toHaveBeenCalled())
      expect(storage.moveToFolder).toHaveBeenCalledWith(HANDLE, 'copy')
    })

    it('選択ダイアログでキャンセルすると、何も変えずに閉じる', async () => {
      const { storage, reload } = setup({ picker: { describe: vi.fn(async () => EXISTING) } })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'キャンセル' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(storage.moveToFolder).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })

    it('開こうとしたファイルが不正(InvalidBackupFileError)なら、開けない理由と変更していないことを示す', async () => {
      const { reload } = setup({
        picker: { describe: vi.fn(async () => EXISTING) },
        storage: { moveToFolder: vi.fn(async () => Promise.reject(new InvalidBackupFileError('invalid'))) },
      })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'この内容で進む' }))

      const d = await screen.findByRole('alertdialog')
      expect(d).toHaveTextContent('このフォルダのファイルは開けません')
      expect(d).toHaveTextContent('今のデータは変更していません')
      expect(reload).not.toHaveBeenCalled()
    })

    it('その他の失敗では、失敗したことを示し、再読み込みしない', async () => {
      const { reload } = setup({
        storage: { moveToFolder: vi.fn(async () => Promise.reject(new Error('disk full'))) },
      })
      fireEvent.click(await within(region()).findByRole('button', { name: 'フォルダを選ぶ…' }))

      expect(await screen.findByRole('alertdialog')).toHaveTextContent('失敗しました')
      expect(reload).not.toHaveBeenCalled()
    })
  })

  describe('ブラウザ内へ戻す', () => {
    async function openRevertDialog() {
      fireEvent.click(await within(region()).findByRole('button', { name: 'ブラウザ内に戻す…' }))
      return screen.findByRole('dialog', { name: '保存先をブラウザ内に戻します' })
    }

    it('既定は「フォルダの最新データをコピーして戻す」で、進むと戻して再読み込みする', async () => {
      const { storage, reload } = setup({ status: FOLDER })
      const d = await openRevertDialog()
      expect(within(d).getByRole('radio', { name: /最新データを、ブラウザ内にコピーして戻す/ })).toBeChecked()

      fireEvent.click(within(d).getByRole('button', { name: 'ブラウザ内に戻す' }))

      await waitFor(() => expect(reload).toHaveBeenCalled())
      expect(storage.moveToIndexedDb).toHaveBeenCalledWith('copy')
    })

    it('「ブラウザ内の古いデータをそのまま使う」を選ぶと、コピーせずに戻す', async () => {
      const { storage, reload } = setup({ status: FOLDER })
      const d = await openRevertDialog()

      fireEvent.click(within(d).getByRole('radio', { name: /古いデータをそのまま使う/ }))
      fireEvent.click(within(d).getByRole('button', { name: 'ブラウザ内に戻す' }))

      await waitFor(() => expect(reload).toHaveBeenCalled())
      expect(storage.moveToIndexedDb).toHaveBeenCalledWith('keep')
    })

    it('ダイアログからデータの書き出しを行える', async () => {
      const { exportCurrent } = setup({ status: FOLDER })
      const d = await openRevertDialog()
      fireEvent.click(within(d).getByRole('button', { name: '今のデータを書き出す' }))
      expect(exportCurrent).toHaveBeenCalledTimes(1)
    })

    it('キャンセルすると、何も変えずに閉じる', async () => {
      const { storage, reload } = setup({ status: FOLDER })
      const d = await openRevertDialog()
      fireEvent.click(within(d).getByRole('button', { name: 'キャンセル' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(storage.moveToIndexedDb).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })
  })
})
