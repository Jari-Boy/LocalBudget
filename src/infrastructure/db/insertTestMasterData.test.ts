/**
 * insertTestMasterData(Repository統合テスト用の単一エンティティINSERTヘルパー)のテスト。
 * 世帯メンバー・プロジェクト・取引先を生SQLで1件INSERTし、採番されたIDを返す関数を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。createTestDatabase + runMigrations で作ったメモリDBを使う。
 * 複数エンティティを一括で作る複合フィクスチャは対象外(単一エンティティの最小粒度のみ)。
 */
import type { Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from './createTestDatabase'
import { insertCounterparty, insertHouseholdMember, insertProject } from './insertTestMasterData'
import { runMigrations } from './migrations'

let database: Database

beforeEach(async () => {
  database = await createTestDatabase()
  runMigrations(database)
})

function selectName(table: string, id: number): string | undefined {
  const rows = database.exec(`SELECT name FROM ${table} WHERE id = ${id}`)
  return rows[0]?.values[0][0] as string | undefined
}

describe('insertHouseholdMember', () => {
  it('指定した名前の世帯メンバーを1件INSERTし、そのIDを返す', () => {
    const id = insertHouseholdMember(database, '自分')

    expect(selectName('household_members', id)).toBe('自分')
  })

  it('続けて呼ぶと異なるIDを返す', () => {
    const first = insertHouseholdMember(database, '自分')
    const second = insertHouseholdMember(database, '配偶者')

    expect(second).not.toBe(first)
    expect(selectName('household_members', second)).toBe('配偶者')
  })
})

describe('insertProject', () => {
  it('指定した名前のプロジェクトを1件INSERTし、そのIDを返す', () => {
    const id = insertProject(database, '旅行')

    expect(selectName('projects', id)).toBe('旅行')
  })
})

describe('insertCounterparty', () => {
  it('指定した名前の取引先を1件INSERTし、そのIDを返す', () => {
    const id = insertCounterparty(database, 'イオン')

    expect(selectName('counterparties', id)).toBe('イオン')
  })
})
