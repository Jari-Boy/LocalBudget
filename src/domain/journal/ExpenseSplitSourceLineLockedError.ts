/**
 * 割勘済みの行(割勘仕訳が元の行として記録している行、計画Issue #271)の、金額・科目・貸借の変更や削除
 * (行の削除・元の仕訳の削除)を行おうとした場合にスローされるドメインエラー。割勘仕訳が元の行の金額を
 * 前提にしているため、先に割勘を取り消す(割勘仕訳を削除する)必要がある。
 */
export class ExpenseSplitSourceLineLockedError extends Error {
  readonly lineIds: readonly number[]

  constructor(lineIds: readonly number[]) {
    super('割勘済みの行は、金額・科目・貸借の変更と削除ができません。先に割勘を取り消してください')
    this.name = 'ExpenseSplitSourceLineLockedError'
    this.lineIds = lineIds
  }
}
