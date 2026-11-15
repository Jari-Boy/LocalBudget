/**
 * 仕訳テンプレートの内容が不正なときのエラー(計画Issue #201)。名称が空、行が2行未満、借方か貸方の
 * どちらかが無い、金額が正の整数でない、など。貸借の不一致は仕訳と同じUnbalancedJournalEntryErrorで表す。
 */
export class InvalidJournalTemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidJournalTemplateError'
  }
}
