// @vitest-environment jsdom
/**
 * DefaultMemberChangeDialog(科目の既定の世帯メンバーを変えるときの確認、計画Issue #169)のテスト。
 * 変更内容(旧→新)と対象の明細行の件数を示し、「過去の明細行も更新する」「そのまま残す」の選択を
 * 呼び出し側へ渡すことを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefaultMemberChangeDialog } from './DefaultMemberChangeDialog'

afterEach(cleanup)

function renderDialog(overrides: Partial<Parameters<typeof DefaultMemberChangeDialog>[0]> = {}) {
  const handlers = { onCancel: vi.fn(), onConfirm: vi.fn() }
  render(
    <DefaultMemberChangeDialog accountName="現金" fromName="夫" toName="妻" lineCount={128} busy={false} {...handlers} {...overrides} />,
  )
  return handlers
}

describe('DefaultMemberChangeDialog', () => {
  it('科目名・旧→新の名義・対象の明細行の件数を示す', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: '既定の世帯メンバーの変更' })
    expect(dialog).toHaveTextContent('現金')
    expect(dialog).toHaveTextContent('夫 → 妻')
    expect(dialog).toHaveTextContent('128 件')
  })

  it('既定メンバーがなかった科目は「なし → 新」と示す', () => {
    renderDialog({ fromName: 'なし' })
    expect(screen.getByRole('dialog')).toHaveTextContent('なし → 妻')
  })

  it('初期状態は「過去の明細行も更新する」が選ばれていて、そのまま「変更する」を押すと更新ありで確定する', () => {
    const { onConfirm } = renderDialog()
    expect(screen.getByRole('radio', { name: /過去の明細行も更新する/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('「そのまま残す」を選んで「変更する」を押すと、更新なしで確定する', () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: /そのまま残す/ }))
    fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('「キャンセル」を押すと確定せずに閉じる', () => {
    const { onCancel, onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('処理中は「変更する」を押せない', () => {
    renderDialog({ busy: true })
    expect(screen.getByRole('button', { name: '変更する' })).toBeDisabled()
  })
})
