/**
 * navigator.storage.persist()を呼び出し、永続化ストレージへの昇格をブラウザに
 * リクエストする(docs/architecture.md 9章「既知の制約・将来課題」、計画Issue #27 目標1)。
 * ブラウザの「閲覧データを削除」操作等によるIndexedDB上のデータ消失リスクを下げるため、
 * アプリの起動処理の一部として早期に呼ぶことを想定する(呼び出し自体は冪等)。
 * navigator.storageが存在しない環境ではpersist()を呼ばずfalseを返す(機能検出)。
 * Web Worker/RPC層には依存しない独立したモジュールとして実装する。
 */
export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) return false

  return navigator.storage.persist()
}
