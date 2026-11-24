import type { Database } from 'sql.js'

import householdMembersSql from '../../../docs/schema/household_members.sql?raw'
import accountsSql from '../../../docs/schema/accounts.sql?raw'
import projectsSql from '../../../docs/schema/projects.sql?raw'
import counterpartiesSql from '../../../docs/schema/counterparties.sql?raw'
import keywordRulesSql from '../../../docs/schema/keyword_rules.sql?raw'
import settlementBatchesSql from '../../../docs/schema/settlement_batches.sql?raw'
import journalSql from '../../../docs/schema/journal.sql?raw'
import budgetsSql from '../../../docs/schema/budgets.sql?raw'
import recurringTransactionsSql from '../../../docs/schema/recurring_transactions.sql?raw'
import reconciliationSql from '../../../docs/schema/reconciliation.sql?raw'
import statementImportSql from '../../../docs/schema/statement_import.sql?raw'
import journalTemplatesSql from '../../../docs/schema/journal_templates.sql?raw'
import seedMarkersSql from '../../../docs/schema/seed_markers.sql?raw'

import { convertLegacyCounterpartyPatterns } from './legacyKeywordRules'
import { MigrationFailedError, SchemaTooNewError } from './migrationErrors'
import { MIGRATION_V2_SYSTEM_ROLE } from './migrationV2SystemRole'
import { MIGRATION_V3_NORMALIZE_KEYWORDS } from './migrationV3NormalizeKeywords'
import { MIGRATION_V4_NORMALIZE_DESCRIPTIONS } from './migrationV4NormalizeDescriptions'
import { MIGRATION_V5_STATEMENT_IMPORT_DRAFTS } from './migrationV5StatementImportDrafts'
import { MIGRATION_V6_FAVORITES } from './migrationV6Favorites'
import { MIGRATION_V7_NORMALIZE_KANA_KEYWORDS } from './migrationV7NormalizeKanaKeywords'
import { MIGRATION_V8_EXPENSE_SPLIT_SOURCE_LINES } from './migrationV8ExpenseSplitSourceLines'
import { MIGRATION_V9_SETTLEMENT_BATCH_CLOSE } from './migrationV9SettlementBatchClose'
import { MIGRATION_V10_NORMALIZE_DETACHED_DAKUTEN_KEYWORDS } from './migrationV10NormalizeDetachedDakutenKeywords'
import { MIGRATION_V11_NORMALIZE_DETACHED_DAKUTEN_DESCRIPTIONS } from './migrationV11NormalizeDetachedDakutenDescriptions'

/**
 * 最新スキーマと差分の2本立て(計画Issue #42、docs/decisions.md)。
 * - 新規DB: docs/schema/*.sql(最新のDDL)をそのまま流し、user_versionを最新にする
 * - 既存DB: 差分(DIFFS)をバージョン順に1つのトランザクションで流す。SQL文字列とTypeScript関数のどちらでも書ける
 * 本番前は、スキーマ変更はDDLを直接修正してよい(差分は足さない)。初回の本番デプロイの直前に
 * `npm run schema:freeze` でその時点のスキーマを凍結すると、以後は固定データ(src/infrastructure/db/schemaFixtures)
 * との比較テストが、差分の書き忘れをCIで検出する(docs/guides/schema-migration.md)。
 */
export type MigrationStep = string | ((db: Database) => void)

export interface MigrationPlan {
  latestVersion: number
  /** 空のDBに最新スキーマを作る */
  createLatest: (db: Database) => void
  /** version-1 → version への差分。キーは移行先のバージョン */
  diffs: Readonly<Record<number, readonly MigrationStep[]>>
}

export const LATEST_SCHEMA_VERSION = 11

// household_members → accounts(household_membersを参照) → projects/counterparties
// → settlement_batches(counterpartiesを参照) → journal(accounts/projects/counterparties/
// settlement_batchesを参照) → budgets(accountsを参照)
// → recurring_transactions(accounts等を参照しjournal_entriesにALTER TABLEを追加するためjournalより後)
// → reconciliation/statement_import(accounts/journal_entriesを参照) → journal_templates の順で適用する。
export const LATEST_SCHEMA_SQL: readonly string[] = [
  householdMembersSql,
  accountsSql,
  projectsSql,
  counterpartiesSql,
  keywordRulesSql,
  settlementBatchesSql,
  journalSql,
  budgetsSql,
  recurringTransactionsSql,
  reconciliationSql,
  statementImportSql,
  journalTemplatesSql,
  // 起動時の初期投入(seed)の印。seed側も CREATE TABLE IF NOT EXISTS で作るが、最新スキーマに含めておかないと、
  // 「新規作成」と「固定データ+差分」の比較が、seedが作る表の有無でずれる(計画Issue #42)
  seedMarkersSql,
]

export const SCHEMA_PLAN: MigrationPlan = {
  latestVersion: LATEST_SCHEMA_VERSION,
  createLatest: (db) => {
    for (const sql of LATEST_SCHEMA_SQL) db.run(sql)
  },
  // 本番前(凍結前)は差分を足さず、DDLを直接修正する。初回の本番デプロイの直前に、その時点のスキーマを
  // バージョン1として凍結する(docs/guides/schema-migration.md)。凍結後のスキーマ変更は、ここに差分を足す
  diffs: {
    // v2(計画Issue #223): accounts.system_role(システム管理科目の役割)の追加
    2: MIGRATION_V2_SYSTEM_ROLE,
    // v3: キーワードマスタ(keyword_rules.pattern)の標準化(NFKC・大文字化・空白除去)。表の形は変えない
    3: MIGRATION_V3_NORMALIZE_KEYWORDS,
    // v4: 取り込み済みの仕訳の摘要の標準化と、キーワードのハイフンの標準化(表の形は変えない)
    4: MIGRATION_V4_NORMALIZE_DESCRIPTIONS,
    // v5(計画Issue #231 フェーズ3): 明細取込の一時保存の表(statement_import_drafts・statement_import_draft_files)の追加
    5: MIGRATION_V5_STATEMENT_IMPORT_DRAFTS,
    // v6(計画Issue #231 フェーズ4): 科目・取引先・プロジェクトのお気に入りの列(is_favorite)の追加と、システム管理科目のトリガーの更新
    6: MIGRATION_V6_FAVORITES,
    // v7(計画Issue #236): キーワードの、ひらがな・カタカナの小書き文字の統一(表の形は変えない)
    7: MIGRATION_V7_NORMALIZE_KANA_KEYWORDS,
    // v8(計画Issue #271): 割勘対象行の記録の表(expense_split_source_lines)と、記録がある行の変更を拒否するトリガーの追加
    8: MIGRATION_V8_EXPENSE_SPLIT_SOURCE_LINES,
    // v9(計画Issue #249): 精算バッチのクローズ(settlement_batches.is_active)と、クローズ時の振替仕訳の記録の表の追加
    9: MIGRATION_V9_SETTLEMENT_BATCH_CLOSE,
    // v10(計画Issue #279): キーワードの、かな+空白+分離した濁点の再正規化(表の形は変えない)
    10: MIGRATION_V10_NORMALIZE_DETACHED_DAKUTEN_KEYWORDS,
    // v11(計画Issue #279): 取り込み済みの仕訳の摘要の、かな+空白+分離した濁点の整形(表の形は変えない)
    11: MIGRATION_V11_NORMALIZE_DETACHED_DAKUTEN_DESCRIPTIONS,
  },
}

export function getUserVersion(db: Database): number {
  const result = db.exec('PRAGMA user_version')
  return (result[0]?.values[0]?.[0] as number | undefined) ?? 0
}

function hasUserTables(db: Database): boolean {
  const result = db.exec("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  return (result[0]?.values[0]?.[0] as number) > 0
}

/** 既存のDB(表がある)で、user_versionが最新より古いか。空のDBは最新スキーマを作るだけなのでfalse。 */
export function needsMigration(db: Database, plan: MigrationPlan = SCHEMA_PLAN): boolean {
  return hasUserTables(db) && getUserVersion(db) < plan.latestVersion
}

/**
 * DBを最新のスキーマにする(計画Issue #42)。
 * - user_versionが最新より大きければ、何も変えずSchemaTooNewErrorで拒否する
 * - 空のDBは最新スキーマを作り、user_versionを最新にする
 * - 既存DBは、外部キー検査を止めた1つのトランザクションで差分を流し、最後にforeign_key_checkで
 *   違反が無いことを確かめてCOMMITする。失敗したらROLLBACKしてMigrationFailedErrorを投げる(DBは元のまま)
 */
export function runMigrations(db: Database, plan: MigrationPlan = SCHEMA_PLAN): void {
  const currentVersion = getUserVersion(db)
  if (currentVersion > plan.latestVersion) {
    throw new SchemaTooNewError(currentVersion, plan.latestVersion)
  }

  if (!hasUserTables(db)) {
    db.run('BEGIN')
    try {
      plan.createLatest(db)
      db.run(`PRAGMA user_version = ${plan.latestVersion}`)
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw new MigrationFailedError(`failed to create the latest schema: ${describe(error)}`, { cause: error })
    }
    return
  }

  if (currentVersion === plan.latestVersion) {
    // 旧形式(counterparty_patterns)のDB・バックアップを変換する凍結前の暫定処理(計画Issue #219)
    convertLegacyCounterpartyPatterns(db)
    return
  }
  if (currentVersion === 0) {
    throw new MigrationFailedError('database has tables but no schema version (user_version = 0)')
  }

  // 外部キー検査の切り替えはトランザクションの外でしか効かない(SQLiteの仕様)
  db.run('PRAGMA foreign_keys = OFF')
  try {
    db.run('BEGIN')
    try {
      for (let version = currentVersion + 1; version <= plan.latestVersion; version++) {
        for (const step of plan.diffs[version] ?? []) {
          if (typeof step === 'string') db.run(step)
          else step(db)
        }
        db.run(`PRAGMA user_version = ${version}`)
      }
      const violations = db.exec('PRAGMA foreign_key_check')
      if (violations.length > 0) {
        throw new Error(`foreign key violations remain after migration (${violations[0].values.length} rows)`)
      }
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw new MigrationFailedError(
        `failed to migrate schema from version ${currentVersion} to ${plan.latestVersion}: ${describe(error)}`,
        { cause: error },
      )
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON')
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
