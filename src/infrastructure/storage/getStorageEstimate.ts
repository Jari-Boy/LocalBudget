/**
 * navigator.storage.estimate()を呼び出し、使用量(usage)/割当量(quota)を取得する
 * (docs/architecture.md 9章「既知の制約・将来課題」、計画Issue #27 目標2)。
 * StorageEstimateのusage/quotaは仕様上省略されうる(ブラウザ実装依存)ため、欠落時は
 * 0にフォールバックする。navigator.storageが存在しない環境ではestimate()を呼ばず
 * nullを返す(機能検出)。Web Worker/RPC層には依存しない独立したモジュールとして実装する。
 */
export interface StorageEstimateResult {
  usage: number
  quota: number
}

export async function getStorageEstimate(): Promise<StorageEstimateResult | null> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) return null

  const { usage, quota } = await navigator.storage.estimate()
  return { usage: usage ?? 0, quota: quota ?? 0 }
}
