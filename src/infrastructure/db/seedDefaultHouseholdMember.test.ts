/**
 * seedDefaultHouseholdMember の統合テスト(計画Issue #88)。
 * household_membersが0件の状態でWorker起動時に呼ばれた場合にデフォルトメンバーを
 * 1件自動投入すること、既に1件以上存在する場合は再投入しない冪等性を、
 * seedBuiltInMappingDefinitions(docs/domain/statement-import.md 2.3節)と同じ設計方針で検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { seedDefaultHouseholdMember } from './seedDefaultHouseholdMember'

let db: Database
let repository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsHouseholdMemberRepository(db)
})

describe('seedDefaultHouseholdMember', () => {
  it('household_membersが0件の場合、デフォルトメンバーを1件投入する', () => {
    seedDefaultHouseholdMember(db)

    expect(repository.findAll()).toHaveLength(1)
  })

  it('投入されるデフォルトメンバーは通常のメンバー(個人・アクティブ)として作成され、改名・削除を妨げない', () => {
    seedDefaultHouseholdMember(db)

    const [member] = repository.findAll()
    expect(member.isGroup).toBe(false)
    expect(member.isActive).toBe(true)
  })

  it('既に1件以上のメンバーが存在する場合は再投入しない(冪等)', () => {
    repository.create({ name: '夫' })

    seedDefaultHouseholdMember(db)

    expect(repository.findAll()).toHaveLength(1)
    expect(repository.findAll()[0].name).toBe('夫')
  })

  it('2回連続で呼び出しても1件しか投入しない(Worker起動のたびに呼ばれても冪等)', () => {
    seedDefaultHouseholdMember(db)
    seedDefaultHouseholdMember(db)

    expect(repository.findAll()).toHaveLength(1)
  })

  it('ユーザーが唯一のメンバーを削除して0件に戻した場合、次回起動時に再投入される', () => {
    seedDefaultHouseholdMember(db)
    const [seeded] = repository.findAll()
    repository.delete(seeded.id)

    seedDefaultHouseholdMember(db)

    expect(repository.findAll()).toHaveLength(1)
  })
})
