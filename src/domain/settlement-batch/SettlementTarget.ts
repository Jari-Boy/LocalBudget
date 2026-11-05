/**
 * 精算画面の「対象者」(計画Issue #139)。世帯メンバー間の精算は明細行のhousehold_member_idで、
 * 世帯外の相手(取引先)との精算はsettlement_batches.counterparty_idで識別する
 * (docs/domain/settlement.md、journal_lines.counterparty_idは資産・負債の行に設定できないため、
 * 取引先側の識別は明細行ではなくバッチ側のタグに委ねる、docs/domain/counterparties.md 1.2)。
 */
export type SettlementTarget =
  | { kind: 'householdMember'; householdMemberId: number }
  | { kind: 'counterparty'; counterpartyId: number }
