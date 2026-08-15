import type { AccountCategory } from '../../domain/account/Account'

/**
 * seedDevSampleData(計画Issue #101)が投入する開発専用ダミー口座の確定リスト。
 * いずれもis_reconcilable = falseで作成する(外部明細CSVとの突合が不要な、UI動作確認用の
 * 簡略化された口座であるため。詳細はseedDevSampleData.tsのdocstring参照)。
 */
export const DEV_SAMPLE_ACCOUNTS: readonly { category: AccountCategory; name: string }[] = [
  { category: 'asset', name: '現金' },
  { category: 'asset', name: '普通預金' },
  { category: 'liability', name: 'クレジットカード' },
] as const

/**
 * seedDevSampleData(計画Issue #101)が投入する開発専用ダミー仕訳の確定リスト。
 * debitAccountName/creditAccountNameはDEV_SAMPLE_ACCOUNTS、またはseedDefaultAccounts
 * (計画Issue #96、defaultAccountSeedData.ts)が投入する標準収益・費用科目名のいずれかを指す。
 * daysAgoは仕訳投入時点(seedDevSampleDataのtoday引数)からの経過日数で、
 * 「直近1ヶ月分の数件の仕訳」という完了条件を満たすようすべて31日以内に収める。
 */
export const DEV_SAMPLE_JOURNAL_ENTRIES: readonly {
  daysAgo: number
  memo: string
  debitAccountName: string
  creditAccountName: string
  amount: number
}[] = [
  { daysAgo: 25, memo: '給与振込', debitAccountName: '普通預金', creditAccountName: '給与収入', amount: 250000 },
  { daysAgo: 18, memo: '近所のスーパーで買い物', debitAccountName: '食費', creditAccountName: '現金', amount: 3200 },
  { daysAgo: 12, memo: '電車運賃', debitAccountName: '交通費', creditAccountName: '現金', amount: 1200 },
  { daysAgo: 3, memo: '外食', debitAccountName: '食費', creditAccountName: 'クレジットカード', amount: 4500 },
] as const
