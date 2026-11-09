/**
 * 精算画面の「対象者」(計画Issue #139、#169)。対象者は常に世帯メンバーで、立替金・未払金の残高は
 * 「科目×世帯メンバー」の明細行(journal_lines.household_member_id)で持つ。世帯外の相手(取引先)との
 * 精算でも、バッチが取引先(settlement_batches.counterparty_id)を表すだけで、立替金・未払金の行は
 * 世帯メンバーの行である(docs/domain/settlement.md、docs/domain/counterparties.md 1.2)。
 */
export type SettlementTarget = { kind: 'householdMember'; householdMemberId: number }
