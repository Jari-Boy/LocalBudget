import type { Database } from 'sql.js'
import { getUserVersion } from './migrations'

/**
 * DBのスキーマ・全データ・user_versionを、そのまま流し込めるSQLテキストにして返す(計画Issue #42)。
 * スキーマ凍結(scripts/freeze-schema.ts)が、本番で公開したバージョンの固定データ(フィクスチャ)を
 * 作るのに使う。人がレビューしやすいよう、バイナリではなくSQLテキストにする。
 * 先頭で外部キー検査を止めるのは、テーブルの並び(作成順)が外部キーの親子順と一致するとは限らないため。
 * BLOB列はX'..'の16進リテラルで書き出す。
 */
export function dumpDatabaseAsSql(db: Database): string {
  const lines: string[] = ['PRAGMA foreign_keys = OFF;']

  const objects = db.exec(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
  )[0]?.values ?? []

  // テーブル → インデックス・トリガー・ビューの順(後者は前者を参照する)
  const tables = objects.filter(([type]) => type === 'table')
  const others = objects.filter(([type]) => type !== 'table')
  for (const [, , sql] of tables) lines.push(`${String(sql)};`)

  for (const [, name] of tables) {
    const result = db.exec(`SELECT * FROM "${String(name).replace(/"/g, '""')}"`)[0]
    if (result === undefined) continue
    const columns = result.columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
    for (const values of result.values) {
      lines.push(`INSERT INTO "${String(name)}" (${columns}) VALUES (${values.map(toLiteral).join(', ')});`)
    }
  }

  for (const [, , sql] of others) lines.push(`${String(sql)};`)
  lines.push(`PRAGMA user_version = ${getUserVersion(db)};`)
  lines.push('PRAGMA foreign_keys = ON;')
  return `${lines.join('\n')}\n`
}

function toLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (value instanceof Uint8Array) {
    return `X'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`
  }
  return `'${String(value).replace(/'/g, "''")}'`
}
