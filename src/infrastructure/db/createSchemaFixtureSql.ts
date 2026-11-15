import type { Database } from 'sql.js'
import { dumpDatabaseAsSql } from './dumpDatabaseAsSql'
import { SCHEMA_PLAN, runMigrations } from './migrations'
import { seedAdvanceAccounts } from './seedAdvanceAccounts'
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedBuiltInMappingDefinitions } from './seedBuiltInMappingDefinitions'
import { seedDefaultAccounts } from './seedDefaultAccounts'
import { seedDefaultHouseholdMember } from './seedDefaultHouseholdMember'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { seedSettlementAdjustmentAccounts } from './seedSettlementAdjustmentAccounts'
import { seedStandardAccountGroups } from './seedStandardAccountGroups'

/** スキーマの固定データ(フィクスチャ)のファイル名。schemaFixtures/ に置く(schemaFixtures.test.tsが読む) */
export function schemaFixtureFileName(version: number): string {
  return `v${version}.sql`
}

/**
 * 現在の最新スキーマの固定データ(フィクスチャ)のSQLテキストを作る(計画Issue #42)。
 * 新規DBを作り、起動時と同じ初期投入(seed。db.worker.tsの順)で、ひと通りのデータを入れてから書き出す。
 * 初回の本番デプロイの直前に `npm run schema:freeze` が呼ぶ(docs/guides/schema-migration.md)。
 */
export async function createSchemaFixtureSql(createDatabase: () => Promise<Database>): Promise<string> {
  const db = await createDatabase()
  try {
    runMigrations(db, SCHEMA_PLAN)
    seedDefaultHouseholdMember(db)
    seedBuiltInMappingDefinitions(db)
    seedDefaultAccounts(db)
    seedAdvanceAccounts(db)
    seedInitialBalanceAccount(db)
    seedBalanceAdjustmentAccount(db)
    seedSettlementAdjustmentAccounts(db)
    seedStandardAccountGroups(db)
    return dumpDatabaseAsSql(db)
  } finally {
    db.close()
  }
}
