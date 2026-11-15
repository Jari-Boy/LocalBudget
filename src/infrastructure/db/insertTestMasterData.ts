import type { Database } from 'sql.js'

/**
 * Repository統合テスト用の、単一エンティティを生SQLで1件INSERTしてIDを返すヘルパー。
 * Repositoryのcreate()を経由せずにマスタ行を用意したいテストで使う。
 * createTestDatabase() + runMigrations() で作ったDBと組み合わせて使う。
 * 複数エンティティを一括で作る複合フィクスチャは意図的に提供しない(各テストが必要な組み合わせを組み立てる)。
 */

export function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

export function insertProject(database: Database, name: string): number {
  database.run(`INSERT INTO projects (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

export function insertCounterparty(database: Database, name: string): number {
  database.run(`INSERT INTO counterparties (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
