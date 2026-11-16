/**
 * convertLegacyCounterpartyPatterns(旧 counterparty_patterns 表をキーワードルールへ変換する暫定処理)のテスト。
 * 移行前形式のDB・バックアップ(旧表を持つDB)が、起動時とバックアップ読み込み時に失われず
 * keyword_rules へ移ること、推定結果が移行前後で変わらないこと、二重に変換しても壊れないことを検証する
 * (計画Issue #219、docs/decisions.md 2026-11-16。凍結時に取り除く暫定措置)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { convertLegacyCounterpartyPatterns } from './legacyKeywordRules'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsKeywordRuleRepository } from './SqlJsKeywordRuleRepository'

/** 最新スキーマのDBを、移行前の形式(keyword_rulesなし・counterparty_patternsあり)に戻す */
async function createLegacyDatabase(): Promise<{ db: Database; aeonId: number }> {
  const db = await createTestDatabase()
  runMigrations(db)
  const aeonId = new SqlJsCounterpartyRepository(db).create({ name: 'イオン' }).id
  db.run('DROP TABLE keyword_rules')
  db.run(`CREATE TABLE counterparty_patterns (
    id INTEGER PRIMARY KEY,
    counterparty_id INTEGER NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    pattern TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  db.run("INSERT INTO counterparty_patterns (counterparty_id, pattern) VALUES (?, 'AEON'), (?, 'イオン')", [aeonId, aeonId])
  return { db, aeonId }
}

describe('convertLegacyCounterpartyPatterns', () => {
  it('旧表の行を、取引先付き・科目なしのルールへ写して旧表を削除する', async () => {
    const { db, aeonId } = await createLegacyDatabase()

    convertLegacyCounterpartyPatterns(db)

    const rules = new SqlJsKeywordRuleRepository(db).findAll()
    expect(rules.map((r) => [r.pattern, r.counterpartyId, r.accountId])).toEqual([
      ['AEON', aeonId, null],
      ['イオン', aeonId, null],
    ])
    expect(db.exec("SELECT name FROM sqlite_master WHERE name = 'counterparty_patterns'")).toEqual([])
  })

  it('変換後の照合結果は、移行前の部分一致と同じ取引先になる', async () => {
    const { db, aeonId } = await createLegacyDatabase()

    convertLegacyCounterpartyPatterns(db)

    const matches = new SqlJsKeywordRuleRepository(db).findMatching('AEONMALL')
    expect(matches.map((r) => r.counterpartyId)).toEqual([aeonId])
  })

  it('旧表が無いDBでは何も変えない(二重に呼んでも壊れない)', async () => {
    const { db } = await createLegacyDatabase()
    convertLegacyCounterpartyPatterns(db)

    convertLegacyCounterpartyPatterns(db)

    expect(new SqlJsKeywordRuleRepository(db).findAll()).toHaveLength(2)
  })

  it('runMigrationsが、旧形式のDBを開くときに自動で変換する', async () => {
    const { db } = await createLegacyDatabase()

    runMigrations(db)

    expect(new SqlJsKeywordRuleRepository(db).findAll()).toHaveLength(2)
  })
})
