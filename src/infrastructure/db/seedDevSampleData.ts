import type { Database } from 'sql.js'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { DEV_SAMPLE_ACCOUNTS, DEV_SAMPLE_JOURNAL_ENTRIES } from './devSampleData'

/**
 * journal_entriesが1件も存在しない場合に、少数の口座(DEV_SAMPLE_ACCOUNTS: 現金・普通預金・
 * クレジットカード)と直近1ヶ月分の数件のダミー仕訳(DEV_SAMPLE_JOURNAL_ENTRIES)を自動投入する
 * (開発環境限定、計画Issue #101)。npm run dev起動直後から一覧表示・集計・グラフ等のUI動作確認が
 * すぐにできる状態を作るためのものであり、本番ビルドには含まれない
 * (呼び出し元のseedDevSampleDataIfDev.ts参照)。
 * 冪等性の判定基準はjournal_entriesの0件判定のみ(seedDefaultHouseholdMemberと同じ考え方)。
 * 相手科目(食費・交通費・給与収入)はseedDefaultAccounts(計画Issue #96)が投入する標準科目に
 * 依存するため、db.worker.tsのmain()内ではseedDefaultAccounts(db)より後に呼び出す必要がある。
 * 投入する口座はいずれもis_reconcilable = falseで作成する。UI動作確認用の簡略化されたダミー
 * データであり、外部明細CSVとの突合(is_reconcilable = trueに伴うsource_type制限、
 * docs/domain/reconciliation.md 1.2)を再現する必要がないため、手入力(source_type = 'manual'、
 * 既定値)のままどの口座にも直接記帳できるようにしている。
 */
export function seedDevSampleData(db: Database, today: Date = new Date()): void {
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  if (journalEntryRepository.findAll().length > 0) return

  const accountRepository = new SqlJsAccountRepository(db)
  for (const seed of DEV_SAMPLE_ACCOUNTS) {
    accountRepository.create({ category: seed.category, name: seed.name, isReconcilable: false })
  }

  const accountIdByName = new Map(
    accountRepository.findAll().map((account) => [account.name, account.id]),
  )
  const householdMemberId = new SqlJsHouseholdMemberRepository(db).findAll()[0]!.id

  for (const entry of DEV_SAMPLE_JOURNAL_ENTRIES) {
    journalEntryRepository.create({
      entryDate: formatDateDaysAgo(today, entry.daysAgo),
      memo: entry.memo,
      householdMemberId,
      lines: [
        { accountId: accountIdByName.get(entry.debitAccountName)!, side: 'debit', amount: entry.amount },
        { accountId: accountIdByName.get(entry.creditAccountName)!, side: 'credit', amount: entry.amount },
      ],
    })
  }
}

function formatDateDaysAgo(today: Date, daysAgo: number): string {
  const date = new Date(today)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}
