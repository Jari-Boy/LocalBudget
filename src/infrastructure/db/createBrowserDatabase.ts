import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/**
 * ブラウザ(Web Worker)上でsql.jsの空データベースを生成する。
 * Node向けのcreateTestDatabase(readFileSyncでWASMを読む)はブラウザでは動作しないため、
 * Viteの`?url`インポートでバンドル後のWASMアセットURLを取得し、fetch経由で読み込む
 * (docs/architecture.md 5章)。Node/VitestはこのURL解決・fetchパイプラインを
 * 再現できないため、動作検証はPlaywright(実ブラウザ)側で行う(Issue #24)。
 */
export async function createBrowserDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  const db = new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')
  return db
}
