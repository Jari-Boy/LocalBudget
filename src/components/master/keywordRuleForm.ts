import type { Account } from '../../domain/account/Account'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'
import { validateKeyword } from '../statement-import/counterpartyKeywordModel'

/**
 * キーワードルールの共通検証と並び替え(計画Issue #219)。キーワードタブ・勘定科目タブ・取引先タブの
 * どの編集経路でも、ここを通して同じ理由で不正なキーワードを拒否する(docs/decisions.md 2026-11-16 決定9)。
 * キーワード自体の検証(空・正規化後の重複)は、明細取込と共通の validateKeyword を使う。
 */
export type KeywordRuleError = 'empty' | 'duplicate' | 'targetRequired' | 'counterpartyNeedsPlAccount'

/** 保存するキーワードの形。取引先の推定は正規化した摘要に照合するため、正規化(全角半角・大文字・空白除去)して保存する */
export const toStoredKeyword = (text: string): string => normalizeDescriptionForMatching(text)

export function validateKeywordRuleInput(params: {
  pattern: string
  counterpartyId: number | null
  accountId: number | null
  /** accountIdの科目(科目を指定しないときはnull) */
  account: Pick<Account, 'id' | 'category'> | null
  /** 同じキーワードかを比べる、編集中のルール以外のルール */
  siblings: readonly KeywordRule[]
}): KeywordRuleError | null {
  const otherTexts = params.siblings
    .filter((r) => r.counterpartyId === params.counterpartyId && r.accountId === params.accountId)
    .map((r) => r.pattern)
  const keywordError = validateKeyword({ text: params.pattern, otherTexts, sourceDescription: null })
  if (keywordError === 'empty') return 'empty'
  if (keywordError === 'duplicate') return 'duplicate'
  if (params.counterpartyId === null && params.accountId === null) return 'targetRequired'
  if (
    params.counterpartyId !== null &&
    params.account !== null &&
    params.account.category !== 'revenue' &&
    params.account.category !== 'expense'
  ) {
    return 'counterpartyNeedsPlAccount'
  }
  return null
}

export type KeywordSortKey = 'pattern' | 'counterparty' | 'account'
export interface KeywordSortState {
  key: KeywordSortKey
  direction: 'asc' | 'desc'
}

/** 列見出しを押したときの次の並び順: 同じ列なら昇順↔降順、別の列ならその列の昇順 */
export function nextSortState(current: KeywordSortState, pressed: KeywordSortKey): KeywordSortState {
  if (current.key === pressed) return { key: pressed, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key: pressed, direction: 'asc' }
}

/** 一覧の並び替え。取引先・科目の列は名前で比べ、持たない(空の)ものは昇順の最後に回す */
export function sortKeywordRules(
  rules: readonly KeywordRule[],
  sort: KeywordSortState,
  names: { counterparty: (id: number | null) => string; account: (id: number | null) => string },
): KeywordRule[] {
  const valueOf = (r: KeywordRule) =>
    sort.key === 'pattern' ? r.pattern : sort.key === 'counterparty' ? names.counterparty(r.counterpartyId) : names.account(r.accountId)
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...rules].sort((a, b) => {
    const x = valueOf(a)
    const y = valueOf(b)
    if (x === '' && y !== '') return sign
    if (y === '' && x !== '') return -sign
    return sign * x.localeCompare(y, 'ja') || a.id - b.id
  })
}
