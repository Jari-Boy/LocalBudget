/**
 * 未保存の変更の警告を「出す / 出さない」の設定(計画Issue #190)の保持を担う
 * loadUnsavedWarningEnabled / saveUnsavedWarningEnabled のユニットテスト。
 * 既定は「出す」であること、保存した値が再訪時に復元されること、不正な値や localStorage が
 * 使えない環境(例外)でも「出す」に倒れて画面が壊れないことを検証する。
 * localStorage は Node/Vitest 環境にないため、スタブ(vi.stubGlobal)で置き換える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUnsavedWarningEnabled, saveUnsavedWarningEnabled } from './unsavedWarningSetting'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

describe('unsavedWarningSetting', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('何も保存されていなければ、警告を出す(true)', () => {
    expect(loadUnsavedWarningEnabled()).toBe(true)
  })

  it('「出さない」を保存すると、次回の読み込みで false が復元される', () => {
    saveUnsavedWarningEnabled(false)
    expect(loadUnsavedWarningEnabled()).toBe(false)
  })

  it('「出す」に戻すと、次回の読み込みで true が復元される', () => {
    saveUnsavedWarningEnabled(false)
    saveUnsavedWarningEnabled(true)
    expect(loadUnsavedWarningEnabled()).toBe(true)
  })

  it('保存された値が壊れているときは、警告を出す(true)', () => {
    localStorage.setItem('localbudget:unsaved-warning', 'xyz')
    expect(loadUnsavedWarningEnabled()).toBe(true)
  })

  it('localStorage が例外を投げる環境でも、読み込みは true を返し、保存は例外を出さない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadUnsavedWarningEnabled()).toBe(true)
    expect(() => saveUnsavedWarningEnabled(false)).not.toThrow()
  })
})
