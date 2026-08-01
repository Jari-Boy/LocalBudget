/**
 * DBの永続化先を抽象化するポート(docs/architecture.md 4.2節)。
 * DBの実体(sql.jsのインメモリDatabase)を「バイト列としてどこに書き出すか」の
 * 問題として切り出し、Web Worker側のDBアクセス層とは独立に差し替えられるようにする。
 */
export interface StorageAdapter {
  load(): Promise<Uint8Array | null>
  save(data: Uint8Array): Promise<void>
}
