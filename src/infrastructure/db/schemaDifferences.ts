import type { Database } from 'sql.js'

/**
 * 2つのDBのスキーマを定義レベルで比べ、食い違いを人が読める文字列で返す(計画Issue #42)。
 * 「固定データ+差分」と「最新スキーマから新規作成」が一致することを検査し、差分の書き忘れを検出するのに使う。
 *
 * 比較するもの: テーブルごとの列(名前・型・NOT NULL・既定値・主キー位置。並びは見ない)・外部キー・
 * CHECK制約、インデックス(UNIQUE・部分インデックス・列。自動インデックスは列で比べる)、トリガー、ビュー。
 * CREATE文は、コメントと空白の書式差を正規化してから比べる。テーブルのCREATE文全体は比べない
 * (ALTER TABLE ADD COLUMNは文の末尾に列を足すため、最初から定義した場合と文が一致しないので、
 * 列とCHECK制約を個別に比べる)。
 */
export function findSchemaDifferences(a: Database, b: Database): string[] {
  const left = describeSchema(a)
  const right = describeSchema(b)
  const differences: string[] = []

  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const l = left.get(key)
    const r = right.get(key)
    if (l === undefined) differences.push(`${key}: only in the second database`)
    else if (r === undefined) differences.push(`${key}: only in the first database`)
    else if (l !== r) differences.push(`${key}: differs\n  first:  ${l}\n  second: ${r}`)
  }
  return differences
}

/** 「種類 名前 → 定義の正規化済み文字列」の表。1項目が1つの比較単位 */
function describeSchema(db: Database): Map<string, string> {
  const entries = new Map<string, string>()
  const objects = rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")

  for (const { type, name, sql } of objects) {
    if (type === 'table') {
      entries.set(`table ${name}`, 'exists')
      for (const column of rows(db, `PRAGMA table_xinfo(${quote(name)})`)) {
        entries.set(
          `column ${name}.${column.name}`,
          [column.type, column.notnull, normalizeValue(column.dflt_value), column.pk, column.hidden].join('|'),
        )
      }
      const foreignKeys = rows(db, `PRAGMA foreign_key_list(${quote(name)})`)
        .map((fk) => [fk.from, fk.table, fk.to, fk.on_update, fk.on_delete, fk.match].join('>'))
        .sort()
      entries.set(`foreign keys ${name}`, foreignKeys.join(';'))
      entries.set(`check constraints ${name}`, extractChecks(String(sql)).sort().join(';'))
      for (const index of rows(db, `PRAGMA index_list(${quote(name)})`)) {
        if (index.origin === 'c') continue // CREATE INDEXで作ったものはsqlite_masterの側で比べる
        const columns = rows(db, `PRAGMA index_info(${quote(index.name)})`).map((c) => c.name)
        entries.set(`constraint index ${name}(${columns.join(',')})`, `unique=${index.unique} origin=${index.origin}`)
      }
    } else if (type === 'index' || type === 'trigger' || type === 'view') {
      // sqlがnullの自動インデックスはtable側で扱った
      if (sql !== null) entries.set(`${type} ${name}`, normalizeSql(String(sql)))
    }
  }
  return entries
}

function rows(db: Database, sql: string): Record<string, string | number | null | Uint8Array>[] {
  const result = db.exec(sql)[0]
  if (result === undefined) return []
  return result.values.map((values) => Object.fromEntries(result.columns.map((column, i) => [column, values[i]])))
}

function quote(value: unknown): string {
  const identifier = String(value)
  return `"${identifier.replace(/"/g, '""')}"`
}

function normalizeValue(value: unknown): string {
  return value === null || value === undefined ? '' : normalizeSql(String(value))
}

/** コメントを除き、空白を詰める。括弧・カンマ・演算子まわりの空白の有無の差も吸収する */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>+\-*/])\s*/g, '$1')
    .trim()
}

/** CREATE TABLE文から CHECK ( ... ) の中身を、括弧の対応を数えて取り出す(文字列リテラル内の括弧は無視) */
function extractChecks(sql: string): string[] {
  const checks: string[] = []
  const pattern = /\bCHECK\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    let inString = false
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i]
      if (ch === "'") inString = !inString
      else if (!inString && ch === '(') depth++
      else if (!inString && ch === ')') depth--
    }
    checks.push(normalizeSql(sql.slice(start, i - 1)))
  }
  return checks
}
