import type { MigrationStep } from './migrations'

/**
 * スキーマ v11 → v12 の差分(仕訳の出どころに金融機関名を表示する、計画Issue #289)。
 * external_transaction_refs に financial_institution_name(取込時の金融機関名。NULL許容)を足す。
 * 既存の取込の記録は、どの金融機関から取り込んだか分からないので NULL のままにする(データの変換はしない。
 * 画面では「外部明細」と表示する)。
 *
 * この差分は凍結されたバージョンの記録なので、後から最新のDDL(docs/schema/*.sql)が変わっても書き換えない。
 */
export const MIGRATION_V12_FINANCIAL_INSTITUTION_NAME: readonly MigrationStep[] = [
  'ALTER TABLE external_transaction_refs ADD COLUMN financial_institution_name TEXT',
]
