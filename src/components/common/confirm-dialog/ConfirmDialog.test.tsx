// @vitest-environment jsdom
/**
 * ConfirmDialog(はい/いいえの確認ダイアログの共通部品、計画Issue #231 フェーズ3)のコンポーネントテスト。
 * タイトルをダイアログの名前にして、説明文・実行ボタン・キャンセルを出すこと、ボタンの押下で呼び出し側のコールバックが
 * 1回だけ呼ばれること、Escapeキーでキャンセルになること、実行中(busy)は実行ボタンを押せないことを確認する。
 * 外部依存: なし(jsdom)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog title="一時保存を破棄しますか" message="CSVと入力内容を削除します。" confirmLabel="破棄する" onConfirm={onConfirm} onCancel={onCancel} {...props} />,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('タイトルを名前にしたダイアログに、説明文・実行ボタン・キャンセルを出す', () => {
    setup()

    expect(screen.getByRole('dialog', { name: '一時保存を破棄しますか' })).toBeInTheDocument()
    expect(screen.getByText('CSVと入力内容を削除します。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '破棄する' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
  })

  it('実行ボタンでonConfirm、キャンセルでonCancelが、それぞれ1回だけ呼ばれる', () => {
    const { onConfirm, onCancel } = setup()

    fireEvent.click(screen.getByRole('button', { name: '破棄する' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escapeキーでキャンセルになる', () => {
    const { onCancel, onConfirm } = setup()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('実行中(busy)は、実行ボタンを押せない', () => {
    setup({ busy: true })

    expect(screen.getByRole('button', { name: '破棄する' })).toBeDisabled()
  })

  it('キャンセルのラベルを変えられる', () => {
    setup({ cancelLabel: 'やめる' })

    expect(screen.getByRole('button', { name: 'やめる' })).toBeInTheDocument()
  })
})
