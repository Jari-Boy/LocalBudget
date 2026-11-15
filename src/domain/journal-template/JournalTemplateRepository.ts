import type {
  CreateJournalTemplateInput,
  JournalTemplate,
  UpdateJournalTemplateInput,
} from './JournalTemplate'

/**
 * 仕訳テンプレート(journal_templates・journal_template_lines)の永続化を担うRepositoryのポート。
 * 行の検証(2行以上・借方と貸方の両方・金額は正の整数または空欄・全行の金額があるときの貸借の一致・
 * 精算バッチの付けられる科目)は書き込み前に実装側が行い、取引先のPL科目限定・名称の一意はDDL
 * (docs/schema/journal_templates.sql)が強制する。書き込みはテンプレートと行を1つの単位で行い、
 * 途中で失敗したら何も残さない。
 */
export interface JournalTemplateRepository {
  create(input: CreateJournalTemplateInput): JournalTemplate
  findById(id: number): JournalTemplate | null
  findAll(): JournalTemplate[]
  update(id: number, input: UpdateJournalTemplateInput): JournalTemplate
  delete(id: number): void
  deactivate(id: number): JournalTemplate
  activate(id: number): JournalTemplate
}
