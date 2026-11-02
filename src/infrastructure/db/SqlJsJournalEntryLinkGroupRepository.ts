import type { Database } from 'sql.js'
import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { JournalEntryLinkGroupRepository } from '../../domain/journal-link-group/JournalEntryLinkGroupRepository'
import { planJoinOrCreateGroups } from '../../domain/journal-link-group/planJoinOrCreateGroups'

/**
 * JournalEntryLinkGroupRepository(ドメイン層のポート)のsql.js実装(計画Issue #138)。
 * メンバーが0件になったグループの削除はDBトリガー(docs/schema/journal.sql、
 * journal_entry_link_groups_delete_when_empty)に委ねており、本実装側では明示的な
 * 後始末を行わない。
 */
export class SqlJsJournalEntryLinkGroupRepository implements JournalEntryLinkGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  createGroup(journalEntryIds: readonly number[]): JournalEntryLinkGroup {
    const uniqueIds = [...new Set(journalEntryIds)]
    if (uniqueIds.length < 2) {
      throw new Error('journal entry link group requires at least 2 distinct journal entries')
    }

    this.db.run('BEGIN')
    try {
      this.db.run('INSERT INTO journal_entry_link_groups DEFAULT VALUES')
      const groupId = lastInsertRowId(this.db)
      for (const journalEntryId of uniqueIds) {
        this.insertMembership(groupId, journalEntryId)
      }
      this.db.run('COMMIT')
      return this.findGroupById(groupId)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  addMember(linkGroupId: number, journalEntryId: number): void {
    this.insertMembership(linkGroupId, journalEntryId)
  }

  findGroupIdsForEntry(journalEntryId: number): number[] {
    const [result] = this.db.exec(
      'SELECT link_group_id FROM journal_entry_link_group_memberships WHERE journal_entry_id = ? ORDER BY link_group_id',
      [journalEntryId],
    )
    if (!result) return []
    return result.values.map((values) => values[0] as number)
  }

  findAllMemberships(): JournalEntryLinkGroupMembership[] {
    const [result] = this.db.exec('SELECT * FROM journal_entry_link_group_memberships ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToMembership(result.columns, values))
  }

  joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void {
    const existingGroupIdsByEntryId = new Map(
      anchorEntryIds.map((entryId) => [entryId, this.findGroupIdsForEntry(entryId)]),
    )
    const plan = planJoinOrCreateGroups(anchorEntryIds, newEntryIds, existingGroupIdsByEntryId)

    if (plan.type === 'create') {
      this.createGroup(plan.journalEntryIds)
      return
    }

    for (const groupId of plan.groupIds) {
      for (const entryId of plan.newEntryIds) {
        this.addMember(groupId, entryId)
      }
    }
  }

  private findGroupById(id: number): JournalEntryLinkGroup | null {
    const [result] = this.db.exec('SELECT * FROM journal_entry_link_groups WHERE id = ?', [id])
    if (!result) return null
    return mapRowToGroup(result.columns, result.values[0])
  }

  /** UNIQUE(link_group_id, journal_entry_id)制約への重複INSERTを無視する(既に所属済みなら何もしない) */
  private insertMembership(linkGroupId: number, journalEntryId: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO journal_entry_link_group_memberships (link_group_id, journal_entry_id) VALUES (?, ?)',
      [linkGroupId, journalEntryId],
    )
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToGroup(columns: string[], values: unknown[]): JournalEntryLinkGroup {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return { id: get<number>('id'), createdAt: get<string>('created_at') }
}

function mapRowToMembership(columns: string[], values: unknown[]): JournalEntryLinkGroupMembership {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    linkGroupId: get<number>('link_group_id'),
    journalEntryId: get<number>('journal_entry_id'),
    createdAt: get<string>('created_at'),
  }
}
