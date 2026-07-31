/**
 * SqlJsHouseholdMemberRepository のグループ機能(household_member_group_memberships)に関する
 * 統合テスト。docs/domain/household-members.md 1.5・docs/schema/household_members.sql に定義された
 * グループへの個人メンバー追加・除去・所属一覧取得と、グループのネスト禁止トリガーの挙動を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'

let db: Database
let repository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsHouseholdMemberRepository(db)
})

describe('addGroupMember / findGroupMembers', () => {
  it('adds individual members to a group and lists them', () => {
    const husband = repository.create({ name: '夫' })
    const wife = repository.create({ name: '妻' })
    const couple = repository.create({ name: '夫婦', isGroup: true })

    repository.addGroupMember(couple.id, husband.id)
    repository.addGroupMember(couple.id, wife.id)

    const members = repository.findGroupMembers(couple.id)

    expect(members.map((m) => m.name)).toEqual(expect.arrayContaining(['夫', '妻']))
  })

  it('returns an empty array for a group with no members', () => {
    const couple = repository.create({ name: '夫婦', isGroup: true })

    expect(repository.findGroupMembers(couple.id)).toEqual([])
  })

  it('rejects nesting a group inside another group', () => {
    const innerGroup = repository.create({ name: '内側グループ', isGroup: true })
    const outerGroup = repository.create({ name: '外側グループ', isGroup: true })

    expect(() => repository.addGroupMember(outerGroup.id, innerGroup.id)).toThrow()
  })

  it('rejects using a non-group member as the group side', () => {
    const husband = repository.create({ name: '夫' })
    const wife = repository.create({ name: '妻' })

    expect(() => repository.addGroupMember(husband.id, wife.id)).toThrow()
  })
})

describe('removeGroupMember', () => {
  it('removes a member from a group', () => {
    const husband = repository.create({ name: '夫' })
    const wife = repository.create({ name: '妻' })
    const couple = repository.create({ name: '夫婦', isGroup: true })
    repository.addGroupMember(couple.id, husband.id)
    repository.addGroupMember(couple.id, wife.id)

    repository.removeGroupMember(couple.id, husband.id)

    const members = repository.findGroupMembers(couple.id)
    expect(members.map((m) => m.name)).toEqual(['妻'])
  })
})
