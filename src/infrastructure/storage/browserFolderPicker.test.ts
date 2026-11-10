/**
 * createBrowserFolderPicker のユニットテスト(計画Issue #174)。設定画面のフォルダ選択の本番実装。
 * showDirectoryPickerでフォルダを選ばせ、ユーザーがダイアログを閉じた(AbortError)ときはエラーに
 * せずnullを返す。それ以外の失敗はそのまま投げる。showDirectoryPickerはNodeに無いため、
 * 差し替え可能な引数で偽物を渡す(実ブラウザでの動作はE2Eで検証する)。
 * 外部依存: なし。
 */
import { describe, expect, it, vi } from 'vitest'
import { createBrowserFolderPicker } from './browserFolderPicker'

const HANDLE = { name: 'フォルダ' } as FileSystemDirectoryHandle

describe('createBrowserFolderPicker', () => {
  it('選ばれたフォルダを、readwriteで要求して返す', async () => {
    const showDirectoryPicker = vi.fn(async () => HANDLE)
    const picker = createBrowserFolderPicker({ showDirectoryPicker, isSupported: () => true })
    expect(await picker.pick()).toBe(HANDLE)
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('ユーザーがダイアログを閉じた(AbortError)ならnullを返す', async () => {
    const showDirectoryPicker = vi.fn(async () => Promise.reject(new DOMException('closed', 'AbortError')))
    const picker = createBrowserFolderPicker({ showDirectoryPicker, isSupported: () => true })
    expect(await picker.pick()).toBeNull()
  })

  it('AbortError以外の失敗はそのまま投げる', async () => {
    const showDirectoryPicker = vi.fn(async () => Promise.reject(new DOMException('blocked', 'SecurityError')))
    const picker = createBrowserFolderPicker({ showDirectoryPicker, isSupported: () => true })
    await expect(picker.pick()).rejects.toThrow('blocked')
  })

  it('対応判定を、環境の判定(isSupported)から返す', () => {
    const showDirectoryPicker = vi.fn()
    expect(createBrowserFolderPicker({ showDirectoryPicker, isSupported: () => false }).isSupported).toBe(false)
    expect(createBrowserFolderPicker({ showDirectoryPicker, isSupported: () => true }).isSupported).toBe(true)
  })
})
