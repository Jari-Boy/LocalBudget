/**
 * FS画面(計画Issue #34)のプロジェクト別・世帯メンバー別・取引先別の複数選択絞り込み
 * (docs/domain/financial-statements.md 2.2節)。各フィールドは省略時に絞り込みなし
 * (全件対象)、指定時は配列内のいずれかに一致すれば含める(複数選択=OR)。
 * 複数フィールドを同時に指定した場合は各軸の判定結果をANDで組み合わせる。
 */
export interface FinancialStatementFilter {
  projectIds?: readonly number[]
  householdMemberIds?: readonly number[]
  counterpartyIds?: readonly number[]
}
