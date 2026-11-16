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
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
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

/** 旧形式の取引先表(counterparties.default_account_id列あり)を再現する。最新スキーマにはこの列が無い */
function addLegacyDefaultAccountColumn(db: Database): void {
  db.run('ALTER TABLE counterparties ADD COLUMN default_account_id INTEGER REFERENCES accounts(id)')
}

describe('取引先の旧default_account_id(計画Issue #219 決定14)', () => {
  it('旧パターンから作るルールの科目に、取引先の旧default_account_idを入れる', async () => {
    const { db, aeonId } = await createLegacyDatabase()
    const food = new SqlJsAccountRepository(db).create({ category: 'expense', name: '食費', isReconcilable: null })
    addLegacyDefaultAccountColumn(db)
    db.run('UPDATE counterparties SET default_account_id = ? WHERE id = ?', [food.id, aeonId])

    convertLegacyCounterpartyPatterns(db)

    expect(new SqlJsKeywordRuleRepository(db).findAll().map((r) => [r.pattern, r.counterpartyId, r.accountId])).toEqual([
      ['AEON', aeonId, food.id],
      ['イオン', aeonId, food.id],
    ])
  })

  it('変換済みでキーワードルールの科目が空のDBにも、旧default_account_idを科目として入れ、列の値は消す(二重に呼んでも変わらない)', async () => {
    const { db, aeonId } = await createLegacyDatabase()
    convertLegacyCounterpartyPatterns(db)
    const food = new SqlJsAccountRepository(db).create({ category: 'expense', name: '食費', isReconcilable: null })
    addLegacyDefaultAccountColumn(db)
    db.run('UPDATE counterparties SET default_account_id = ? WHERE id = ?', [food.id, aeonId])

    convertLegacyCounterpartyPatterns(db)
    convertLegacyCounterpartyPatterns(db)

    expect(new SqlJsKeywordRuleRepository(db).findAll().map((r) => r.accountId)).toEqual([food.id, food.id])
    expect(db.exec('SELECT default_account_id FROM counterparties')[0].values).toEqual([[null]])
  })

  it('すでに科目が入っているルールは、旧default_account_idで上書きしない', async () => {
    const { db, aeonId } = await createLegacyDatabase()
    convertLegacyCounterpartyPatterns(db)
    const accounts = new SqlJsAccountRepository(db)
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const daily = accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
    new SqlJsKeywordRuleRepository(db).update(1, { accountId: daily.id })
    addLegacyDefaultAccountColumn(db)
    db.run('UPDATE counterparties SET default_account_id = ? WHERE id = ?', [food.id, aeonId])

    convertLegacyCounterpartyPatterns(db)

    expect(new SqlJsKeywordRuleRepository(db).findAll().map((r) => r.accountId)).toEqual([daily.id, food.id])
  })

  it('収益・費用以外の科目が旧default_account_idに入っていても、変換は失敗せず、その科目はルールへ移さない', async () => {
    const { db, aeonId } = await createLegacyDatabase()
    const cash = new SqlJsAccountRepository(db).create({ category: 'asset', name: '現金', isReconcilable: false })
    addLegacyDefaultAccountColumn(db)
    db.run('UPDATE counterparties SET default_account_id = ? WHERE id = ?', [cash.id, aeonId])

    expect(() => convertLegacyCounterpartyPatterns(db)).not.toThrow()
    expect(new SqlJsKeywordRuleRepository(db).findAll().map((r) => r.accountId)).toEqual([null, null])
  })
})

