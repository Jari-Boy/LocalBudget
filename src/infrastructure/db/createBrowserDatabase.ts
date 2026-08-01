import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/**
 * ブラウザ(Web Worker)上でsql.jsのデータベースを生成する。
 * Node向けのcreateTestDatabase(readFileSyncでWASMを読む)はブラウザでは動作しないため、
 * Viteの`?url`インポートでバンドル後のWASMアセットURLを取得し、fetch経由で読み込む
 * (docs/architecture.md 5章)。Node/VitestはこのURL解決・fetchパイプラインを
 * 再現できないため、動作検証はPlaywright(実ブラウザ)側で行う(Issue #24)。
 * `initialData`を渡すとStorageAdapterから復元した既存DBのバイト列から初期化し
 * (計画Issue #25)、省略時は空のデータベースを生成する。
 */
export async function createBrowserDatabase(initialData?: Uint8Array): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  const db = new SQL.Database(initialData)
  db.run('PRAGMA foreign_keys = ON')
  return db
}
