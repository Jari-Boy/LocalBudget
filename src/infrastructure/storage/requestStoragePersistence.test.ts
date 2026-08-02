/**
 * requestStoragePersistence() のユニットテスト。navigator.storage.persist()を呼び出し、
 * 永続化ストレージへの昇格が許可されたかどうかを判定する(docs/architecture.md 9章、
 * 計画Issue #27 目標1)。navigator.storage自体が存在しない環境ではpersist()を呼ばず
 * falseを返す(機能検出フォールバック)。navigator.storageはNode環境に実装がないため、
 * persist()のみを持つモックオブジェクトで許可/拒否/非対応の分岐を検証する。
 * 外部依存: なし。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestStoragePersistence } from './requestStoragePersistence'

describe('requestStoragePersistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persist()がtrueを返す場合、trueを返す(永続化が許可された)', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => true } })

    await expect(requestStoragePersistence()).resolves.toBe(true)
  })

  it('persist()がfalseを返す場合、falseを返す(永続化が拒否された)', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => false } })

    await expect(requestStoragePersistence()).resolves.toBe(false)
  })

  it('navigator.storageが存在しない場合、persist()を呼ばずfalseを返す(非対応環境)', async () => {
    vi.stubGlobal('navigator', {})

    await expect(requestStoragePersistence()).resolves.toBe(false)
  })

  it('navigatorグローバル自体が存在しない場合、falseを返す(Web Worker内等)', async () => {
    vi.stubGlobal('navigator', undefined)

    await expect(requestStoragePersistence()).resolves.toBe(false)
  })
})
