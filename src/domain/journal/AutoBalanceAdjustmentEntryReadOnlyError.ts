/**
 * 自動調整仕訳(source_type = 'auto_balance_adjustment'、計画Issue #205)を、利用者の操作で
 * 更新・削除しようとした場合にスローされるドメインエラー。自動調整仕訳は科目の基準点と帳簿から
 * 計算で導出されるデータで、計算し直しのたびに作り直されるため、編集・削除・関連付けはできない。
 */
export class AutoBalanceAdjustmentEntryReadOnlyError extends Error {
  readonly entryId: number

  constructor(entryId: number) {
    super(`auto balance adjustment entry is read-only; entryId=${entryId}`)
    this.name = 'AutoBalanceAdjustmentEntryReadOnlyError'
    this.entryId = entryId
  }
}
