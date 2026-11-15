/**
 * 初期設定で選ぶ勘定科目テンプレート(計画Issue #177、承認済みモックアップ②)。
 * 収益・費用の科目の出発点で、入ったあとは通常の科目と同じに編集・削除できる。
 * 資産・負債は含めない(口座ごとに外部明細の有無や名義が違うため、利用者が登録する)。ただし資産の
 * 「現金」だけは外部明細も無く誰でも持つので最初から入れる(CASH_ACCOUNT_NAME)。
 * 「雑収入」「雑損失」は精算画面の差額計上に使うため、どのテンプレートでも常に残す
 * (seedSettlementAdjustmentAccountsが投入する。PROTECTED_REVENUE_EXPENSE_NAMES)。
 */
export const ACCOUNT_TEMPLATE_KEYS = ['minimal', 'standard', 'bookkeeping'] as const
export type AccountTemplateKey = (typeof ACCOUNT_TEMPLATE_KEYS)[number]

export interface AccountTemplate {
  key: AccountTemplateKey
  revenue: readonly string[]
  expense: readonly string[]
}

const STANDARD_EXPENSE = [
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
  'その他費用',
] as const

const STANDARD: AccountTemplate = {
  key: 'standard',
  revenue: ['給与収入', '副業収入', 'その他収入'],
  expense: STANDARD_EXPENSE,
}

export const ACCOUNT_TEMPLATES: Record<AccountTemplateKey, AccountTemplate> = {
  minimal: {
    key: 'minimal',
    revenue: ['給与収入', 'その他収入'],
    expense: ['食費', '住居費', '水道光熱費', '通信費', '交通費', 'その他費用'],
  },
  standard: STANDARD,
  bookkeeping: {
    key: 'bookkeeping',
    revenue: ['給与収入', '賞与', '副業収入', '事業収入', '利息・配当', 'その他収入'],
    expense: [
      ...STANDARD_EXPENSE.filter((name) => name !== 'その他費用'),
      '所得税',
      '住民税',
      '社会保険料',
      '租税公課',
      '減価償却費',
      '支払利息',
      'その他費用',
    ],
  },
}

/** 最初から入れる資産の科目(外部明細なし・名義なし) */
export const CASH_ACCOUNT_NAME = '現金'

/** どのテンプレートでも常に残す収益・費用の科目(精算画面の差額計上用。システムが投入する) */
export const PROTECTED_REVENUE_EXPENSE_NAMES: readonly string[] = ['雑収入', '雑損失']

/** 標準に対して、そのテンプレートで増える科目(プレビューで強調する) */
export function findTemplateAdditions(key: AccountTemplateKey): string[] {
  if (key !== 'bookkeeping') return []
  const base = new Set([...STANDARD.revenue, ...STANDARD.expense])
  const template = ACCOUNT_TEMPLATES[key]
  return [...template.revenue, ...template.expense].filter((name) => !base.has(name))
}
