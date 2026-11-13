/**
 * 仕訳一覧の表示方式(仕訳単位 / 明細行単位、計画Issue #182)の保持を担う
 * loadJournalViewMode / saveJournalViewMode のユニットテスト。
 * 初期値は仕訳単位であること、保存した値が再訪時に復元されること、不正な値や
 * localStorage が使えない環境(例外)でも仕訳単位に倒れて画面が壊れないことを検証する。
 * localStorage は Node/Vitest 環境にないため、スタブ(vi.stubGlobal)で置き換える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadJournalViewMode, saveJournalViewMode } from './journalViewMode'

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

describe('journalViewMode', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('何も保存されていなければ、仕訳単位(entry)を返す', () => {
    expect(loadJournalViewMode()).toBe('entry')
  })

  it('明細行単位(line)を保存すると、次回の読み込みで line が復元される', () => {
    saveJournalViewMode('line')
    expect(loadJournalViewMode()).toBe('line')
  })

  it('仕訳単位(entry)に戻して保存すると、次回の読み込みで entry になる', () => {
    saveJournalViewMode('line')
    saveJournalViewMode('entry')
    expect(loadJournalViewMode()).toBe('entry')
  })

  it('保存された値が不正なら、仕訳単位(entry)に倒れる', () => {
    localStorage.setItem('localbudget:journal-view-mode', 'table')
    expect(loadJournalViewMode()).toBe('entry')
  })

  it('localStorage が例外を投げても、読み込みは entry、保存は何もしない(例外を外へ出さない)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadJournalViewMode()).toBe('entry')
    expect(() => saveJournalViewMode('line')).not.toThrow()
  })
})
