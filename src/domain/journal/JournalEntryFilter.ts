/**
 * 仕訳の絞り込み条件(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * 各フィールドは省略時に絞り込みなし(全件対象)。複数フィールドを同時に指定した場合は
 * 各軸の判定結果をANDで組み合わせる(docs/domain/financial-statement/FinancialStatementFilter.ts
 * と同じ考え方だが、対象は明細行ではなく仕訳(entry)単位)。
 */
export interface JournalEntryFilter {
  /** 取引日(entry_date)がこの日付以降の仕訳のみを対象にする(YYYY-MM-DD) */
  dateFrom?: string
  /** 取引日(entry_date)がこの日付以前の仕訳のみを対象にする(YYYY-MM-DD) */
  dateTo?: string
  /** いずれかの明細行がこの科目を含む仕訳のみを対象にする */
  accountId?: number
  /** いずれかの明細行の実効メンバー(resolveEffectiveHouseholdMemberId)がこのメンバーと一致する仕訳のみを対象にする */
  householdMemberId?: number
  /** いずれかの明細行がこのプロジェクトを含む仕訳のみを対象にする */
  projectId?: number
}
