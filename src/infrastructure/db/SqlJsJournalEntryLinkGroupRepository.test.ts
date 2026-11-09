/**
 * SqlJsJournalEntryLinkGroupRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md 1.8・
 * docs/schema/journal.sql に定義された関連仕訳グループ(journal_entry_link_groups/
 * journal_entry_link_group_memberships)の作成・参照、joinOrCreateGroupsによる
 * 参加/新規作成の判定、仕訳削除時のON DELETE CASCADE、メンバー0件時のグループ自動削除
 * (計画Issue #138)を検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsJournalEntryLinkGroupRepository } from './SqlJsJournalEntryLinkGroupRepository'

let db: Database
let repository: SqlJsJournalEntryLinkGroupRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number
let expenseAccountId: number
let cashAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  repository = new SqlJsJournalEntryLinkGroupRepository(db)
  memberId = insertHouseholdMember(db, '自分')
  expenseAccountId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  cashAccountId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
})

function createEntry(): number {
  return journalEntryRepository.create({
    householdMemberId: memberId,
    entryDate: '2026-11-01',
    lines: [
      { householdMemberId: memberId, accountId: expenseAccountId, side: 'debit', amount: 1000 },
      { householdMemberId: memberId, accountId: cashAccountId, side: 'credit', amount: 1000 },
    ],
  }).id
}

describe('createGroup / addMember / findGroupIdsForEntry', () => {
  it('journalEntryIdsをメンバーとする新規グループを作成し、各メンバーのfindGroupIdsForEntryで参照できる', () => {
    const entryA = createEntry()
    const entryB = createEntry()

    const group = repository.createGroup([entryA, entryB])

    expect(repository.findGroupIdsForEntry(entryA)).toEqual([group.id])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([group.id])
  })

  it('addMemberで既存グループに仕訳を追加できる', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryC = createEntry()
    const group = repository.createGroup([entryA, entryB])

    repository.addMember(group.id, entryC)

    expect(repository.findGroupIdsForEntry(entryC)).toEqual([group.id])
  })

  it('addMemberは既に所属済みの仕訳に対しては何もしない(重複エラーにならない)', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    expect(() => repository.addMember(group.id, entryA)).not.toThrow()
    expect(repository.findGroupIdsForEntry(entryA)).toEqual([group.id])
  })

  it('グループに所属していない仕訳に対してはfindGroupIdsForEntryが空配列を返す', () => {
    const entryA = createEntry()

    expect(repository.findGroupIdsForEntry(entryA)).toEqual([])
  })
})

describe('joinOrCreateGroups', () => {
  it('anchorが既存グループを持たない場合、anchor・newEntryIdsをまとめた新規グループを作成する', () => {
    const entryA = createEntry()
    const entryB = createEntry()

    repository.joinOrCreateGroups([entryA], [entryB])

    const groupIds = repository.findGroupIdsForEntry(entryA)
    expect(groupIds).toHaveLength(1)
    expect(repository.findGroupIdsForEntry(entryB)).toEqual(groupIds)
  })

  it('anchorが既存グループを持つ場合、newEntryIdsをそのグループへ参加させる', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryC = createEntry()
    const existingGroup = repository.createGroup([entryA, entryB])

    repository.joinOrCreateGroups([entryA], [entryC])

    expect(repository.findGroupIdsForEntry(entryC)).toEqual([existingGroup.id])
    // entryBは既存グループのまま変化しない
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([existingGroup.id])
  })

  it('anchorが複数の異なる既存グループに所属する場合、newEntryIdsを全グループに参加させるが、それらのグループ自体は統合しない', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryNew = createEntry()
    const groupA = repository.createGroup([entryA, createEntry()])
    const groupB = repository.createGroup([entryB, createEntry()])

    repository.joinOrCreateGroups([entryA, entryB], [entryNew])

    expect(new Set(repository.findGroupIdsForEntry(entryNew))).toEqual(new Set([groupA.id, groupB.id]))
    // entryA・entryBそれぞれの既存の所属は変わらない(統合されない)
    expect(repository.findGroupIdsForEntry(entryA)).toEqual([groupA.id])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([groupB.id])
  })
})

describe('findAllMemberships', () => {
  it('作成した全グループの所属関係を返す', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    const memberships = repository.findAllMemberships()

    expect(memberships.filter((m) => m.linkGroupId === group.id).map((m) => m.journalEntryId).sort()).toEqual(
      [entryA, entryB].sort(),
    )
  })
})

describe('ON DELETE CASCADE / グループ自動削除', () => {
  it('メンバーの仕訳を削除すると、そのメンバーの所属行だけが削除される', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryC = createEntry()
    const group = repository.createGroup([entryA, entryB, entryC])

    journalEntryRepository.delete(entryA)

    expect(repository.findGroupIdsForEntry(entryA)).toEqual([])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([group.id])
    expect(repository.findGroupIdsForEntry(entryC)).toEqual([group.id])
  })

  it('グループのメンバーが0件になった時点で、グループ自体も自動的に削除される', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    journalEntryRepository.delete(entryA)
    journalEntryRepository.delete(entryB)

    const [result] = db.exec('SELECT id FROM journal_entry_link_groups WHERE id = ?', [group.id])
    expect(result).toBeUndefined()
  })
})

describe('removeMember', () => {
  it('グループから仕訳を除外すると、findGroupIdsForEntryが空配列を返すようになる', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryC = createEntry()
    const group = repository.createGroup([entryA, entryB, entryC])

    repository.removeMember(group.id, entryC)

    expect(repository.findGroupIdsForEntry(entryC)).toEqual([])
    expect(repository.findGroupIdsForEntry(entryA)).toEqual([group.id])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([group.id])
  })

  it('残りのメンバーが0件になった場合、グループ自体も自動的に削除される', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    repository.removeMember(group.id, entryA)
    repository.removeMember(group.id, entryB)

    const [result] = db.exec('SELECT id FROM journal_entry_link_groups WHERE id = ?', [group.id])
    expect(result).toBeUndefined()
  })

  it('所属していない仕訳を指定しても何もしない(エラーにならない)', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const entryC = createEntry()
    const group = repository.createGroup([entryA, entryB])

    expect(() => repository.removeMember(group.id, entryC)).not.toThrow()
    expect(repository.findGroupIdsForEntry(entryA)).toEqual([group.id])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([group.id])
  })
})

describe('moveMember', () => {
  it('既存のグループへ移動すると、移動元から除外され移動先に参加する', () => {
    const anchor = createEntry()
    const entryA = createEntry()
    const entryB = createEntry()
    const entryMoving = createEntry()
    const sourceGroup = repository.createGroup([anchor, entryMoving])
    const targetGroup = repository.createGroup([anchor, entryA, entryB])

    repository.moveMember(sourceGroup.id, targetGroup.id, anchor, entryMoving)

    expect(repository.findGroupIdsForEntry(entryMoving)).toEqual([targetGroup.id])
    // 移動元グループ自体はanchorが残っているため削除されない
    expect(repository.findGroupIdsForEntry(anchor).sort()).toEqual([sourceGroup.id, targetGroup.id].sort())
    // 移動先の既存メンバーは影響を受けない
    expect(repository.findGroupIdsForEntry(entryA)).toEqual([targetGroup.id])
    expect(repository.findGroupIdsForEntry(entryB)).toEqual([targetGroup.id])
  })

  it('targetGroupIdにnullを渡すと、anchorEntryIdとjournalEntryIdをメンバーとする新規グループへ移動する', () => {
    const anchor = createEntry()
    const entryOther = createEntry()
    const entryMoving = createEntry()
    const sourceGroup = repository.createGroup([anchor, entryOther, entryMoving])

    repository.moveMember(sourceGroup.id, null, anchor, entryMoving)

    const newGroupIds = repository.findGroupIdsForEntry(entryMoving)
    expect(newGroupIds).toHaveLength(1)
    expect(newGroupIds[0]).not.toBe(sourceGroup.id)
    expect(repository.findGroupIdsForEntry(anchor)).toEqual(expect.arrayContaining([sourceGroup.id, newGroupIds[0]]))
    // 移動元グループのentryOtherは影響を受けない
    expect(repository.findGroupIdsForEntry(entryOther)).toEqual([sourceGroup.id])
  })

  it('移動元グループの残りメンバーが0件になった場合、グループ自体も自動的に削除される', () => {
    const anchor = createEntry()
    const entryMoving = createEntry()
    const otherGroupMember = createEntry()
    const sourceGroup = repository.createGroup([anchor, entryMoving])
    const targetGroup = repository.createGroup([anchor, otherGroupMember])
    // 先にanchorを除外し、sourceGroupをentryMoving1件だけの状態にしておく
    // (createGroupは2件未満を許可しないため、この手順でのみ到達できる状態)
    repository.removeMember(sourceGroup.id, anchor)

    repository.moveMember(sourceGroup.id, targetGroup.id, anchor, entryMoving)

    const [result] = db.exec('SELECT id FROM journal_entry_link_groups WHERE id = ?', [sourceGroup.id])
    expect(result).toBeUndefined()
    expect(repository.findGroupIdsForEntry(entryMoving)).toEqual([targetGroup.id])
  })
})

describe('findAllGroups / renameGroup', () => {
  it('作成直後のグループはnameがnullで、findAllGroupsで参照できる', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    const groups = repository.findAllGroups()

    expect(groups.find((g) => g.id === group.id)?.name).toBeNull()
  })

  it('renameGroupで名前を設定すると、findAllGroupsに反映される', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])

    repository.renameGroup(group.id, '26/7生活費')

    expect(repository.findAllGroups().find((g) => g.id === group.id)?.name).toBe('26/7生活費')
  })

  it('renameGroupにnullを渡すと、名前が未設定(null)に戻る', () => {
    const entryA = createEntry()
    const entryB = createEntry()
    const group = repository.createGroup([entryA, entryB])
    repository.renameGroup(group.id, '26/7生活費')

    repository.renameGroup(group.id, null)

    expect(repository.findAllGroups().find((g) => g.id === group.id)?.name).toBeNull()
  })
})

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return (database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number)
}
