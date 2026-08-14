/**
 * seedDefaultAccounts(計画Issue #96)が投入する標準科目名の確定リスト。
 * docs/domain/accounts.md 1.2節が例示する最小セットを土台に、一般的な家計簿アプリの
 * カテゴリへ拡充したもの。区分ごとに独立してリストを持ち、収益・費用以外の区分
 * (asset/liability/equity)はこのファイルの対象外(計画Issue #96参照)。
 */
export const DEFAULT_REVENUE_ACCOUNT_NAMES = ['給与収入', '副業収入', '謝礼収入'] as const

export const DEFAULT_EXPENSE_ACCOUNT_NAMES = [
  '食費',
  '住居費',
  '水道光熱費',
  '通信費',
  '交通費',
  '日用品費',
  '被服費',
  '医療費',
  '教育費',
  '交際費',
  '保険料',
  '娯楽費',
] as const
