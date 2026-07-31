import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import initSqlJs, { type Database } from 'sql.js'

const require = createRequire(import.meta.url)

/**
 * Node/Vitest上でsql.jsの空データベースを生成するテスト専用ヘルパー。
 * ブラウザ(Web Worker)側のWASM読み込みは別実装が必要(architecture.md 5章、Issue #5スコープ外)。
 * SQLiteはFK制約(REFERENCES)をデフォルトで強制しないため、接続ごとにPRAGMA foreign_keys = ONを
 * 設定する(Issue #7)。これによりON DELETE CASCADE等のFKアクションも有効になる。
 */
export async function createTestDatabase(): Promise<Database> {
  const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const wasmBinary = wasmFile.buffer.slice(
    wasmFile.byteOffset,
    wasmFile.byteOffset + wasmFile.byteLength,
  ) as ArrayBuffer

  const SQL = await initSqlJs({ wasmBinary })
  const db = new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')
  return db
}
