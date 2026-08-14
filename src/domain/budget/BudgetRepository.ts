import type { Budget, CreateBudgetInput, UpdateBudgetInput } from './Budget'

/**
 * 予算(budgets)の永続化を担うRepositoryのポート(インターフェース)。
 * expense区分の科目のみ許可するDDLトリガー・同一科目/同一年月のUNIQUE制約等の
 * ドメインルールはDDL側(docs/schema/budgets.sql)で強制されるため、
 * 実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる
 * (docs/domain/budgets.md参照)。
 */
export interface BudgetRepository {
  create(input: CreateBudgetInput): Budget
  findById(id: number): Budget | null
  findByAccountAndYearMonth(accountId: number, yearMonth: string): Budget | null
  findByYearMonth(yearMonth: string): Budget[]
  /** 全年月・全科目を横断した全件取得(計画Issue #95、科目の削除可否判定の参照件数集計に使用) */
  findAll(): Budget[]
  update(id: number, input: UpdateBudgetInput): Budget
  delete(id: number): void
}
