/**
 * DBの永続化先を抽象化するポート(docs/architecture.md 4.2節)。
 * DBの実体(sql.jsのインメモリDatabase)を「バイト列としてどこに書き出すか」の
 * 問題として切り出し、Web Worker側のDBアクセス層とは独立に差し替えられるようにする。
 */
export interface StorageAdapter {
  load(): Promise<Uint8Array | null>
  save(data: Uint8Array): Promise<void>
  /**
   * マイグレーションを流す前の元のDBを、保存先ごとのバックアップとして保存する(計画Issue #42)。
   * 本体のデータとは別の場所(IndexedDBは別キー、フォルダは同じフォルダの別ファイル)に書き、
   * 直近の1つだけを残す(2回目以降は上書き)。読み取り専用のアダプタなど、持たない実装は省略する。
   */
  savePreMigrationBackup?(data: Uint8Array): Promise<void>
}
