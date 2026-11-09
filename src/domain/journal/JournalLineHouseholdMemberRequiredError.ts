/**
 * 世帯メンバーが入っていない明細行を含む下書きを確定しようとした場合にスローされるドメインエラー
 * (docs/domain/journal.md、計画Issue #169)。下書きの明細行は世帯メンバー未入力を許容するが、
 * 確定する仕訳の明細行は必ず世帯メンバーを持つ。呼び出し側はinstanceofで判定できる。
 */
export class JournalLineHouseholdMemberRequiredError extends Error {
  constructor() {
    super('journal line household member is required to confirm a draft')
    this.name = 'JournalLineHouseholdMemberRequiredError'
  }
}
