import type { AccountCategory } from '../../domain/account/Account'
import type { ProjectKind } from '../../domain/project/Project'

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
 * seedDevSampleData(計画Issue #107)が投入する開発専用ダミー取引先の確定リスト。
 * 「株式会社サンプル商事」は給与振込元(収益側)、「イオン」「サンプル食堂」は支払先(費用側)として
 * DEV_SAMPLE_JOURNAL_ENTRIESのPL行に紐付ける(docs/domain/counterparties.md 1.2、1.6)。
 */
export const DEV_SAMPLE_COUNTERPARTIES: readonly { name: string }[] = [
  { name: '株式会社サンプル商事' },
  { name: 'イオン' },
  { name: 'サンプル食堂' },
] as const

/**
 * seedDevSampleData(計画Issue #107)が投入する開発専用ダミープロジェクトの確定リスト。
 * kindはいずれも'event'(精算バッチ用の'settlement'はUI動作確認用途に合わないため使わない、
 * docs/domain/projects.md参照)。DEV_SAMPLE_JOURNAL_ENTRIESのPL行に紐付ける。
 */
export const DEV_SAMPLE_PROJECTS: readonly { name: string; kind: ProjectKind }[] = [
  { name: '沖縄旅行', kind: 'event' },
] as const

/**
 * seedDevSampleData(計画Issue #101)が投入する開発専用ダミー仕訳の確定リスト。
 * debitAccountName/creditAccountNameはDEV_SAMPLE_ACCOUNTS、またはseedDefaultAccounts
 * (計画Issue #96、defaultAccountSeedData.ts)が投入する標準収益・費用科目名のいずれかを指す。
 * daysAgoは仕訳投入時点(seedDevSampleDataのtoday引数)からの経過日数で、
 * 「直近1ヶ月分の数件の仕訳」という完了条件を満たすようすべて31日以内に収める。
 * debitCounterpartyName/creditCounterpartyName/projectNameは計画Issue #107で追加した
 * 任意フィールドで、DEV_SAMPLE_COUNTERPARTIES/DEV_SAMPLE_PROJECTSの取引先・プロジェクト名を
 * 指す。counterparty系は必ずPL科目(収益・費用)側の行に付与すること
 * (docs/domain/counterparties.md 1.2、DBトリガーで強制されるため資産・負債側の行に付与すると
 * 投入時にエラーになる)。既存の並び・件数・既存フィールドは変更していない(計画Issue #107の
 * 制約・懸念点参照)。
 */
export const DEV_SAMPLE_JOURNAL_ENTRIES: readonly {
  daysAgo: number
  memo: string
  debitAccountName: string
  creditAccountName: string
  amount: number
  debitCounterpartyName?: string
  creditCounterpartyName?: string
  projectName?: string
}[] = [
  {
    daysAgo: 25,
    memo: '給与振込',
    debitAccountName: '普通預金',
    creditAccountName: '給与収入',
    amount: 250000,
    creditCounterpartyName: '株式会社サンプル商事',
  },
  {
    daysAgo: 18,
    memo: '近所のスーパーで買い物',
    debitAccountName: '食費',
    creditAccountName: '現金',
    amount: 3200,
    debitCounterpartyName: 'イオン',
  },
  {
    daysAgo: 12,
    memo: '電車運賃',
    debitAccountName: '交通費',
    creditAccountName: '現金',
    amount: 1200,
    projectName: '沖縄旅行',
  },
  {
    daysAgo: 3,
    memo: '外食',
    debitAccountName: '食費',
    creditAccountName: 'クレジットカード',
    amount: 4500,
    debitCounterpartyName: 'サンプル食堂',
    projectName: '沖縄旅行',
  },
] as const
