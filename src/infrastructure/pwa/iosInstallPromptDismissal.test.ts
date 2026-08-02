/**
 * iOS「ホーム画面に追加」誘導ポップアップ(計画Issue #28)の「今後表示しない」選択状態を
 * localStorageへ永続化するモジュールのユニットテスト。navigator.storage系と同様、
 * localStorageはNode/Vitest環境に実装がないためモック化して検証する。
 */
import { describe, expect, test, beforeEach, vi } from 'vitest'
import {
  isIosInstallPromptDismissed,
  dismissIosInstallPrompt,
} from './iosInstallPromptDismissal'

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    get length() {
      return store.size
    },
  }
}

describe('iosInstallPromptDismissal', () => {
  let localStorageMock: Storage

  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  test('初期状態ではisIosInstallPromptDismissed()はfalseを返す', () => {
    expect(isIosInstallPromptDismissed()).toBe(false)
  })

  test('dismissIosInstallPrompt()を呼んだ後はisIosInstallPromptDismissed()がtrueを返す', () => {
    dismissIosInstallPrompt()
    expect(isIosInstallPromptDismissed()).toBe(true)
  })

  test('dismissIosInstallPrompt()はlocalStorage.setItem()経由で永続化する', () => {
    dismissIosInstallPrompt()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'localbudget:ios-install-prompt-dismissed',
      'true',
    )
  })
})
