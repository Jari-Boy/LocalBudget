// @vitest-environment jsdom
/**
 * 外部変更の警告(ExternalChangeBanner)のテスト(計画Issue #175、承認済みモックアップ2・3)。保存先のフォルダの
 * ファイルが別の端末で更新されて保存を止めているとき、画面の上部に「保存されていない」ことを常駐で警告し、
 * 今のデータの書き出しと、フォルダのファイルの開き直し(確認ダイアログ付き)へ導く。通常のときは何も出さない。
 * 保存が止まったかどうかはWorker側の状態なので、定期的にgetStatus()で取り直す。
 * 外部依存: なし。Worker側のAPI・ダウンロード・再読み込み・タイマーは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { StorageStatus } from '../../infrastructure/rpc/createStorageApi'
import { ExternalChangeBanner } from './ExternalChangeBanner'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function status(externalChange: boolean): StorageStatus {
  return { kind: 'folder', folderName: '家計簿', writable: true, externalChange }
}

function setup(initial: StorageStatus, options: { exportError?: boolean } = {}) {
  let current = initial
  const getStatus = vi.fn(async () => current)
  const exportData = vi.fn(async () => {
    if (options.exportError) throw new Error('export failed')
    return new Uint8Array([1, 2, 3])
  })
  const download = vi.fn()
  const reload = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExternalChangeBanner
        storage={{ getStatus }}
        backup={{ export: exportData }}
        download={download}
        reload={reload}
        now={() => new Date(2026, 10, 11, 9, 5)}
        pollIntervalMs={1000}
      />
    </I18nextProvider>,
  )
  return {
    getStatus,
    exportData,
    download,
    reload,
    setStatus: (next: StorageStatus) => {
      current = next
    },
  }
}

describe('ExternalChangeBanner', () => {
  it('外部変更で保存を止めているときは、入力が保存されていないことを警告する', async () => {
    setup(status(true))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('保存を停止しています')
    expect(alert).toHaveTextContent('保存されていません')
  })

  it('通常のときは何も表示しない', async () => {
    const { getStatus } = setup(status(false))
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('表示した後に保存が止まったことを、定期的な取り直しで検知して警告を出す', async () => {
    vi.useFakeTimers()
    const { setStatus } = setup(status(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    setStatus(status(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('「今のデータを書き出す」で今のデータをバックアップとしてダウンロードする', async () => {
    const { exportData, download } = setup(status(true))
    fireEvent.click(await screen.findByRole('button', { name: '今のデータを書き出す' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(exportData).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'local-budget-backup-20261111-0905.sqlite')
  })

  it('書き出しに失敗したら、その旨を表示する', async () => {
    setup(status(true), { exportError: true })
    fireEvent.click(await screen.findByRole('button', { name: '今のデータを書き出す' }))
    expect(await screen.findByText(/書き出せませんでした/)).toBeInTheDocument()
  })

  it('「フォルダのファイルを開き直す」は、すぐには再読み込みせず確認ダイアログを出す', async () => {
    const { reload } = setup(status(true))
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダのファイルを開き直す' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('保存が止まっている間の入力は、失われます')
    expect(reload).not.toHaveBeenCalled()
  })

  it('確認ダイアログの「破棄して開き直す」でページを再読み込みする', async () => {
    const { reload } = setup(status(true))
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダのファイルを開き直す' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄して開き直す' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('確認ダイアログの「キャンセル」では再読み込みせず、警告は出たまま残る', async () => {
    const { reload } = setup(status(true))
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダのファイルを開き直す' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('確認ダイアログからも、今のデータを書き出せる', async () => {
    const { download } = setup(status(true))
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダのファイルを開き直す' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '今のデータを書き出す' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
  })
})
