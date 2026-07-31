import type { Database } from 'sql.js'

import householdMembersSql from '../../../docs/schema/household_members.sql?raw'
import accountsSql from '../../../docs/schema/accounts.sql?raw'
import projectsSql from '../../../docs/schema/projects.sql?raw'
import counterpartiesSql from '../../../docs/schema/counterparties.sql?raw'
import journalSql from '../../../docs/schema/journal.sql?raw'
import budgetsSql from '../../../docs/schema/budgets.sql?raw'
import recurringTransactionsSql from '../../../docs/schema/recurring_transactions.sql?raw'
import reconciliationSql from '../../../docs/schema/reconciliation.sql?raw'
import statementImportSql from '../../../docs/schema/statement_import.sql?raw'

export const LATEST_SCHEMA_VERSION = 1

// household_members → accounts(household_membersを参照) → projects/counterparties
// → journal(accounts/projects/counterpartiesを参照) → budgets(accountsを参照)
// → recurring_transactions(accounts等を参照しjournal_entriesにALTER TABLEを追加するためjournalより後)
// → reconciliation/statement_import(accounts/journal_entriesを参照) の順で適用する。
const MIGRATIONS: Record<number, readonly string[]> = {
  1: [
    householdMembersSql,
    accountsSql,
    projectsSql,
    counterpartiesSql,
    journalSql,
    budgetsSql,
    recurringTransactionsSql,
    reconciliationSql,
    statementImportSql,
  ],
}

export function runMigrations(db: Database): void {
  const currentVersion = getUserVersion(db)

  for (let version = currentVersion + 1; version <= LATEST_SCHEMA_VERSION; version++) {
    for (const sql of MIGRATIONS[version] ?? []) {
      db.run(sql)
    }
    db.run(`PRAGMA user_version = ${version}`)
  }
}

export function getUserVersion(db: Database): number {
  const result = db.exec('PRAGMA user_version')
  return (result[0]?.values[0]?.[0] as number | undefined) ?? 0
}
