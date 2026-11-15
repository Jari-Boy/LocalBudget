// @vitest-environment jsdom
/**
 * 起動エラー画面(StartupErrorScreen)のテスト(計画Issue #42、承認済みモックアップ)。
 * Worker起動の失敗(WorkerInitError)の種類ごとに、案内とボタンを出し分ける。
 * - schema-too-new: 新しいバージョンのアプリで保存されたデータ。「アプリを更新する」と「データを書き出す」
 * - migration-failed: データの更新に失敗。エラー内容と「元のデータを書き出す」「もう一度読み込む」
 * - other: 起動に失敗。エラー内容と「もう一度読み込む」のみ(書き出せるデータが無い)
 * 外部依存: なし。書き出し・更新・再読み込みは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { WorkerInitError } from '../../infrastructure/rpc/WorkerInitError'
import { StartupErrorScreen } from './StartupErrorScreen'

afterEach(cleanup)

function setup(error: WorkerInitError, options: { update?: () => Promise<void> } = {}) {
  const exportData = vi.fn()
  const update = vi.fn(options.update ?? (async () => {}))
  const reload = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <StartupErrorScreen error={error} onExport={exportData} onUpdate={update} onReload={reload} />
    </I18nextProvider>,
  )
  return { exportData, update, reload }
}

const ORIGINAL = new Uint8Array([1, 2, 3])

describe('StartupErrorScreen', () => {
  it('schema-too-new: 新しいバージョンで保存されたデータだと案内し、データは変更されていないと伝える', () => {
    setup(new WorkerInitError('too new', { reason: 'schema-too-new', originalData: ORIGINAL }))

    expect(screen.getByRole('heading', { name: '新しいバージョンのアプリで保存されたデータです' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アプリを更新する' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).not.toBeInTheDocument()
  })

  it('schema-too-new: 「データを書き出す」で元のバイト列を渡す', () => {
    const { exportData } = setup(new WorkerInitError('too new', { reason: 'schema-too-new', originalData: ORIGINAL }))

    fireEvent.click(screen.getByRole('button', { name: 'データを書き出す' }))

    expect(exportData).toHaveBeenCalledWith(ORIGINAL)
  })

  it('schema-too-new: 「アプリを更新する」でonUpdateを呼び、失敗したら理由を示して画面に留まる', async () => {
    const { update } = setup(new WorkerInitError('too new', { reason: 'schema-too-new', originalData: ORIGINAL }), {
      update: async () => {
        throw new Error('offline')
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'アプリを更新する' }))

    expect(update).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('更新できませんでした')
  })

  it('migration-failed: エラー内容を示し、「元のデータを書き出す」と「もう一度読み込む」を出す', () => {
    const { exportData, reload } = setup(
      new WorkerInitError('no such column: example_column', { reason: 'migration-failed', originalData: ORIGINAL }),
    )

    expect(screen.getByRole('heading', { name: 'データを新しい形式に更新できませんでした' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('no such column: example_column')

    fireEvent.click(screen.getByRole('button', { name: '元のデータを書き出す' }))
    expect(exportData).toHaveBeenCalledWith(ORIGINAL)
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(reload).toHaveBeenCalled()
  })

  it('書き出せる元のデータが無いとき(originalDataなし)は、書き出しボタンを出さない', () => {
    setup(new WorkerInitError('failed to create', { reason: 'migration-failed' }))

    expect(screen.queryByRole('button', { name: '元のデータを書き出す' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('other: 起動に失敗したと伝え、エラー内容と「もう一度読み込む」だけを出す', async () => {
    const { reload } = setup(new WorkerInitError('wasm load failed'))

    expect(screen.getByRole('heading', { name: 'アプリを起動できませんでした' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('wasm load failed')
    expect(screen.queryByRole('button', { name: /書き出す/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })
})
