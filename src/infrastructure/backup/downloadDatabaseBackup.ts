import { toDatabaseBlob } from '../storage/databaseFileCodec'

/**
 * DBバイト列をファイルとしてブラウザにダウンロードさせる(docs/architecture.md 8章)。
 * 一時的な<a download>要素をDOMに追加してクリックすることで、ブラウザ標準の
 * ダウンロード動作に委ねる。Blob変換はFileSystemAccessStorageAdapterと共通の
 * databaseFileCodec.toDatabaseBlobを再利用する(計画Issue #26の目標3)。
 * UIエントリポイント(設定画面のボタン等の配置)は別Issueのスコープのため、本関数は
 * 「バイト列とファイル名を受け取りダウンロードを開始する」処理のみを提供する。
 * document/URL.createObjectURLというDOM APIに依存するため、db.worker.ts等と同様に
 * Node/Vitestでは検証できず、Playwrightで検証する(docs/architecture.md 10章)。
 */
export function downloadDatabaseBackup(data: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(toDatabaseBlob(data))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // FirefoxではBlob URLの参照先を即座に破棄すると、クリックによるダウンロード開始
  // (非同期)がまだ完了していない場合に失敗しうるため、次のタスクへ逃がしてから解放する。
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
