/**
 * 帳簿残高と外部残高が一致している(差異が無い)状態で残高調整仕訳の生成を
 * 試みた場合にスローされるドメインエラー(docs/domain/reconciliation.md 1.6)。
 * 残高調整はユーザーが差額の存在を確認したうえで明示的に選ぶ操作のため、
 * 差異0での呼び出しは呼び出し側の誤り(未確認の状態で確定操作を行った等)とみなす。
 */
export class NoBalanceDiscrepancyError extends Error {
  constructor() {
    super('cannot build a balance adjustment journal entry when book and external balances match')
    this.name = 'NoBalanceDiscrepancyError'
  }
}
