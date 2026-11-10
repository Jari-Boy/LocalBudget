/**
 * バックアップ読み込み後のお知らせの印(importNotice)のテスト(計画Issue #173)。
 * 読み込みが終わるとページを再読み込みするため画面の状態は消える。再読み込みの前に
 * sessionStorageへ読み込んだファイル名を残し、再読み込み後に1回だけ取り出せること、
 * ストレージが使えない環境(例外を投げる)でも画面の処理を止めないことを検証する。
 * 外部依存: なし(Storage相当の偽物を渡す)。
 */
import { describe, expect, it } from 'vitest'
import { markImportCompleted, takeImportNotice, type NoticeStorage } from './importNotice'

function createMemoryStorage(): NoticeStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

function createThrowingStorage(): NoticeStorage {
  return {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
}

describe('importNotice', () => {
  it('印を残すと、読み込んだファイル名を取り出せる', () => {
    const storage = createMemoryStorage()
    markImportCompleted('local-budget-backup-20261108-2114.sqlite', storage)
    expect(takeImportNotice(storage)).toBe('local-budget-backup-20261108-2114.sqlite')
  })

  it('取り出した印は消え、2回目はnullになる(お知らせは1回だけ出す)', () => {
    const storage = createMemoryStorage()
    markImportCompleted('a.sqlite', storage)
    takeImportNotice(storage)
    expect(takeImportNotice(storage)).toBeNull()
  })

  it('印がなければnullを返す', () => {
    expect(takeImportNotice(createMemoryStorage())).toBeNull()
  })

  it('ストレージが例外を投げても、印を残す処理は例外を投げない', () => {
    expect(() => markImportCompleted('a.sqlite', createThrowingStorage())).not.toThrow()
  })

  it('ストレージが例外を投げても、取り出す処理は例外を投げずnullを返す', () => {
    expect(takeImportNotice(createThrowingStorage())).toBeNull()
  })
})
