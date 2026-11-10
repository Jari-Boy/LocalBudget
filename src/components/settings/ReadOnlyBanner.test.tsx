// @vitest-environment jsdom
/**
 * 読み取り専用の警告(ReadOnlyBanner)のテスト(計画Issue #174)。別のタブが書き込みの権利を持っていて
 * このタブの変更が保存されないとき、画面の上部に警告を出す。書き込める通常のタブでは何も出さない。
 * 「もう一度確認する」は、他のタブを閉じた後に書き込みの権利を取り直すためのページの再読み込み。
 * 外部依存: なし。Worker側の保存先APIと再読み込みは偽物を渡す。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { StorageStatus } from '../../infrastructure/rpc/createStorageApi'
import { ReadOnlyBanner } from './ReadOnlyBanner'

afterEach(cleanup)

function setup(status: StorageStatus) {
  const getStatus = vi.fn(async () => status)
  const reload = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ReadOnlyBanner storage={{ getStatus }} reload={reload} />
    </I18nextProvider>,
  )
  return { getStatus, reload }
}

describe('ReadOnlyBanner', () => {
  it('書き込めないタブでは、別のタブで開いていて変更が保存されないことを警告する', async () => {
    setup({ kind: 'indexeddb', folderName: null, writable: false })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('別のタブでこのアプリを開いています')
    expect(alert).toHaveTextContent('変更は保存されません')
  })

  it('書き込めるタブでは何も表示しない', async () => {
    const { getStatus } = setup({ kind: 'indexeddb', folderName: null, writable: true })
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('「もう一度確認する」でページを再読み込みする', async () => {
    const { reload } = setup({ kind: 'folder', folderName: '家計簿', writable: false })
    fireEvent.click(await screen.findByRole('button', { name: 'もう一度確認する' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
