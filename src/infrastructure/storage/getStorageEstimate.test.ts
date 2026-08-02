/**
 * getStorageEstimate() のユニットテスト。navigator.storage.estimate()を呼び出し、
 * 使用量(usage)/割当量(quota)を取得する(docs/architecture.md 9章、計画Issue #27 目標2)。
 * StorageEstimateのusage/quotaは仕様上省略されうるため、欠落時は0にフォールバックする。
 * navigator.storage自体が存在しない環境ではestimate()を呼ばずnullを返す(機能検出)。
 * navigator.storageはNode環境に実装がないため、estimate()のみを持つモックオブジェクトで
 * 値取得・欠落フィールド・非対応の分岐を検証する。
 * 外部依存: なし。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStorageEstimate } from './getStorageEstimate'

describe('getStorageEstimate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('estimate()の結果からusage/quotaを取得できる', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 1234, quota: 5678 }) },
    })

    await expect(getStorageEstimate()).resolves.toEqual({ usage: 1234, quota: 5678 })
  })

  it('usage/quotaが欠落している場合、0にフォールバックする', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } })

    await expect(getStorageEstimate()).resolves.toEqual({ usage: 0, quota: 0 })
  })

  it('navigator.storageが存在しない場合、estimate()を呼ばずnullを返す(非対応環境)', async () => {
    vi.stubGlobal('navigator', {})

    await expect(getStorageEstimate()).resolves.toBeNull()
  })

  it('navigatorグローバル自体が存在しない場合、nullを返す(Web Worker内等)', async () => {
    vi.stubGlobal('navigator', undefined)

    await expect(getStorageEstimate()).resolves.toBeNull()
  })
})
