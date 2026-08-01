/**
 * frequencyごとに使用すべきカラムの組み合わせ(docs/domain/recurring-transactions.md 1.3の対応表、
 * docs/schema/recurring_transactions.sql のCHECK制約と同一のルール)に反する入力が
 * 渡された場合にスローされるドメインエラー。呼び出し側はinstanceofで判定できる。
 */
export class InvalidRecurringScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRecurringScheduleError'
  }
}
