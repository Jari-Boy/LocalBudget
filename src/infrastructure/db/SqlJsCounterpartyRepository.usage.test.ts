/**
 * SqlJsCounterpartyRepository の使用件数(countJournalLinesByCounterparty、計画Issue #236)のテスト。
 * 明細取込で、摘要に複数のキーワードが一致した取引先の候補を並べるとき、「過去の使用件数」として使う。
 * 取引先ごとの仕訳明細(journal_lines)の数を返し、使われていない取引先は含めないことを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'

let db: Database
let repository: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsCounterpartyRepository(db)
})

function insertLine(entryId: number, accountId: number, counterpartyId: number | null) {
  db.run(
    `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, counterparty_id, side, amount)
     VALUES (?, ?, (SELECT household_member_id FROM journal_entries WHERE id = ?), ?, 'debit', 1000)`,
    [entryId, accountId, entryId, counterpartyId],
  )
}

describe('countJournalLinesByCounterparty', () => {
  it('取引先ごとの仕訳明細の数を返し、使われていない取引先・取引先なしの明細は含めない', () => {
    const jr = repository.create({ name: 'ジェイアール東日本' })
    const metro = repository.create({ name: '東京メトロ' })
    repository.create({ name: '未使用の店' })
    db.run("INSERT INTO household_members (name) VALUES ('自分')")
    db.run("INSERT INTO accounts (category, name, is_reconcilable) VALUES ('expense', '交通費', NULL)")
    db.run("INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', 1)")
    insertLine(1, 1, jr.id)
    insertLine(1, 1, jr.id)
    insertLine(1, 1, metro.id)
    insertLine(1, 1, null)

    const counts = repository.countJournalLinesByCounterparty()

    expect(counts).toEqual(
      expect.arrayContaining([
        { counterpartyId: jr.id, count: 2 },
        { counterpartyId: metro.id, count: 1 },
      ]),
    )
    expect(counts).toHaveLength(2)
  })

  it('仕訳明細が1件も無ければ空', () => {
    repository.create({ name: '東京メトロ' })

    expect(repository.countJournalLinesByCounterparty()).toEqual([])
  })
})
