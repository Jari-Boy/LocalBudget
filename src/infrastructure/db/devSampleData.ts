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
 * プロジェクトはイベント専用(計画Issue #133、kindは持たない)。DEV_SAMPLE_JOURNAL_ENTRIESの
 * PL行に紐付ける。
 */
export const DEV_SAMPLE_PROJECTS: readonly { name: string }[] = [{ name: '沖縄旅行' }] as const

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
/**
 * seedDevSampleData(計画Issue #139)が投入する開発専用ダミー世帯メンバーの追加リスト。
 * デフォルトメンバー(seedDefaultHouseholdMemberが投入する「自分」)に加えて投入することで、
 * 精算画面(SettlementScreen)の「複数の世帯メンバーに紐づく立替金の仕訳」を手動確認できる
 * ようにする(計画Issue #139完了条件)。
 */
export const DEV_SAMPLE_HOUSEHOLD_MEMBERS: readonly { name: string }[] = [{ name: '配偶者' }] as const

/**
 * seedDevSampleData(計画Issue #139)が投入する開発専用ダミー精算バッチの確定リスト。
 * counterpartyNameを指定したバッチは、対応するDEV_SAMPLE_COUNTERPARTIESの取引先に紐づく
 * (docs/domain/settlement.md 2.1、世帯外の相手との精算バッチ)。
 */
export const DEV_SAMPLE_SETTLEMENT_BATCHES: readonly {
  name: string
  type: 'expense_splitting'
  counterpartyName?: string
}[] = [
  { name: '6月飲み会の割勘', type: 'expense_splitting' },
  { name: '7月生活費の割勘', type: 'expense_splitting' },
  { name: 'イオンの後払い分', type: 'expense_splitting', counterpartyName: 'イオン' },
] as const

/**
 * seedDevSampleData(計画Issue #139)が投入する開発専用ダミーの割勘仕訳(世帯メンバー間)の
 * 確定リスト。docs/domain/expense-splitting.md 1.3節の例の通り、割勘仕訳は「元仕訳(実際に
 * 支払いが発生した仕訳)」の存在を前提に、その一部をfromMemberNameからtoMemberNameへ付け替える
 * ものであり、単独では成立しない。そのため、各割勘仕訳の前に元仕訳(originalAmount/
 * originalDaysAgo/originalMemo/originalCashAccountName、fromMemberNameが全額を支払った体の
 * 単純な2行仕訳)を投入してから、buildHouseholdMemberExpenseSplittingJournalEntryInputで
 * settlement_batch_idを付与した状態(割り当て済み)の割勘仕訳(amount、通常は元仕訳の一部)を
 * 起票する(精算画面の新しい操作モデルでは、割勘仕訳自体は起票時にバッチへ割り当てられている
 * 前提のため)。fromMemberName/toMemberNameはDEV_SAMPLE_HOUSEHOLD_MEMBERS、または
 * seedDefaultHouseholdMemberが投入する「自分」を指す。
 */
export const DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES: readonly {
  daysAgo: number
  memo: string
  batchName: string
  amount: number
  fromMemberName: string
  toMemberName: string
  expenseAccountName: string
  originalAmount: number
  originalDaysAgo: number
  originalMemo: string
  originalCashAccountName: string
}[] = [
  {
    daysAgo: 20,
    memo: '飲み会代の割勘',
    batchName: '6月飲み会の割勘',
    amount: 1500,
    fromMemberName: '自分',
    toMemberName: '配偶者',
    expenseAccountName: '交際費',
    originalAmount: 3000,
    originalDaysAgo: 22,
    originalMemo: '飲み会代(全額立替)',
    originalCashAccountName: '現金',
  },
  {
    daysAgo: 15,
    memo: '生活費の割勘',
    batchName: '7月生活費の割勘',
    amount: 2000,
    fromMemberName: '自分',
    toMemberName: '配偶者',
    expenseAccountName: '日用品費',
    originalAmount: 4000,
    originalDaysAgo: 17,
    originalMemo: '生活用品のまとめ買い(全額立替)',
    originalCashAccountName: '普通預金',
  },
] as const

/**
 * seedDevSampleData(計画Issue #139)が投入する開発専用ダミーの後払い仕訳(取引先・未払金)の
 * 確定リスト。対応するDEV_SAMPLE_SETTLEMENT_BATCHESのbatchName(counterpartyName指定)に
 * settlement_batch_idを付与した状態(割り当て済み)で起票する。未払金(負債)行の
 * household_member_idはpayerMemberNameが支払った当人を指す(docs/domain/settlement.md、
 * journal_lines.counterparty_idは資産・負債の行に設定できないため、取引先との紐付けは
 * バッチ側のcounterparty_idで表現する)。
 */
export const DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES: readonly {
  daysAgo: number
  memo: string
  batchName: string
  amount: number
  payerMemberName: string
  expenseAccountName: string
}[] = [
  {
    daysAgo: 10,
    memo: 'イオンでの買い物(後払い)',
    batchName: 'イオンの後払い分',
    amount: 4000,
    payerMemberName: '自分',
    expenseAccountName: '日用品費',
  },
] as const

/**
 * seedDevSampleData(計画Issue #139)が投入する開発専用ダミーの返済仕訳(精算バッチに未割当)の
 * 確定リスト。精算画面(SettlementScreen)の「消込む仕訳を選ぶ」候補として表示される、
 * settlement_batch_id未設定の立替金(資産)/未払金(負債)行を持つ仕訳。accountCategoryで
 * 資産側(自分が受け取る側)・負債側(自分が支払う側)のどちらの候補かを指定する(docs/domain/
 * expense-splitting.md 1.3節の精算1(負債側)・精算2(資産側)に対応、口座ごとに別々のタイミング・
 * 別々のCSVで到着するため、資産側・負債側は独立した仕訳になる)。memberNameは対象者の世帯メンバーで、
 * 明細行のhousehold_member_idに設定する(明細行は常に世帯メンバーを持つ。世帯外の相手(取引先)の
 * バッチでも、立替金・未払金の行は世帯メンバーの行として表す、計画Issue #169)。
 * 1500円の返済(負債側・資産側それぞれ)はDEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES
 * の1件目(1500円)と一致(精算画面で対象者=自分/配偶者どちらでも「一致」判定を確認できる)、
 * 1200円の返済は2件目(2000円、負債側)と不一致(「不一致」判定・差額損益計上を確認できる)、
 * 4000円の返済はDEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES(4000円、取引先: イオン)と一致する。
 */
export const DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES: readonly {
  daysAgo: number
  memo: string
  amount: number
  accountCategory: 'asset' | 'liability'
  memberName: string
  cashAccountName: string
}[] = [
  {
    daysAgo: 18,
    memo: '配偶者からの立替金返済(飲み会代)',
    amount: 1500,
    accountCategory: 'liability',
    memberName: '配偶者',
    cashAccountName: '現金',
  },
  {
    daysAgo: 16,
    memo: '飲み会代の立替分を現金で受け取り',
    amount: 1500,
    accountCategory: 'asset',
    memberName: '自分',
    cashAccountName: '現金',
  },
  {
    daysAgo: 12,
    memo: '配偶者からの立替金返済(生活費・一部)',
    amount: 1200,
    accountCategory: 'liability',
    memberName: '配偶者',
    cashAccountName: '現金',
  },
  {
    daysAgo: 5,
    memo: 'イオンへの後払い分の支払い',
    amount: 4000,
    accountCategory: 'liability',
    memberName: '自分',
    cashAccountName: '普通預金',
  },
] as const

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
