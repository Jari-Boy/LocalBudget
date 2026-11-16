import type { CreateKeywordRuleInput, KeywordRule, UpdateKeywordRuleInput } from './KeywordRule'

/**
 * キーワードルールの永続化を担うRepositoryのポート。「取引先か科目の少なくとも一方が必須」
 * 「取引先と科目の併記は収益・費用の科目のみ」はDDL(docs/schema/keyword_rules.sql)で強制され、
 * 違反時の例外はそのまま呼び出し元へ伝播する。
 */
export interface KeywordRuleRepository {
  create(input: CreateKeywordRuleInput): KeywordRule
  findById(id: number): KeywordRule | null
  findAll(): KeywordRule[]
  findByCounterparty(counterpartyId: number): KeywordRule[]
  findByAccount(accountId: number): KeywordRule[]
  update(id: number, input: UpdateKeywordRuleInput): KeywordRule
  delete(id: number): void
  /** 正規化済みの摘要に部分一致(LIKE '%pattern%')するルールを返す(docs/domain/counterparties.md 1.3) */
  findMatching(normalizedText: string): KeywordRule[]
}
