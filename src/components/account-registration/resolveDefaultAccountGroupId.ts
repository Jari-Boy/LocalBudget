import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountCategory } from '../../domain/account/Account'
import { STANDARD_ACCOUNT_GROUPS } from '../../infrastructure/db/seedStandardAccountGroups'

export interface DefaultAccountGroupQuestion {
  category: AccountCategory
  /** 外部明細(CSV)があるか。資産の「普通預金」と「現金・電子マネー」の振り分けに使う */
  hasExternalStatement: boolean
}

/** 区分と外部明細の有無から、初期選択する標準グループの識別子を決める。収益・費用などは無し */
function standardGroupKey(question: DefaultAccountGroupQuestion) {
  if (question.category === 'liability') return 'creditCard'
  if (question.category === 'asset') return question.hasExternalStatement ? 'bank' : 'cash'
  return null
}

/**
 * 科目の新規登録フォームで、所属グループの初期選択を決める(計画Issue #154)。
 * 標準グループ(seedStandardAccountGroups)を、区分と名前が一致する最上位の有効なグループとして
 * 探す。標準グループは通常のグループで改名・削除できるため、見つからなければnull(初期選択なし)。
 * 初期選択はあくまで初期値で、利用者はフォームで変更できる。
 */
export function resolveDefaultAccountGroupId(
  question: DefaultAccountGroupQuestion,
  groups: readonly AccountGroup[],
): number | null {
  const key = standardGroupKey(question)
  const standard = STANDARD_ACCOUNT_GROUPS.find((g) => g.key === key)
  if (!standard) return null
  const found = groups.find(
    (g) =>
      g.category === standard.category &&
      g.name === standard.name &&
      g.parentGroupId === null &&
      g.isActive,
  )
  return found?.id ?? null
}
