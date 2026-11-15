import type {
  CreateJournalTemplateGroupInput,
  JournalTemplateGroup,
  UpdateJournalTemplateGroupInput,
} from './JournalTemplateGroup'

/**
 * 仕訳テンプレートのグループ(journal_template_groups)の永続化を担うRepositoryのポート。
 * 子グループ・所属テンプレートがあるグループの物理削除禁止・同じ親の下の名前の一意はDDL
 * (docs/schema/journal_templates.sql)が強制し、実装は制約違反の例外をそのまま伝播させる。
 * 親グループ変更時の循環参照検証は、ドメイン層の純粋関数isDescendantGroupを用いて実装側で行う。
 */
export interface JournalTemplateGroupRepository {
  create(input: CreateJournalTemplateGroupInput): JournalTemplateGroup
  findById(id: number): JournalTemplateGroup | null
  findAll(): JournalTemplateGroup[]
  update(id: number, input: UpdateJournalTemplateGroupInput): JournalTemplateGroup
  delete(id: number): void
  deactivate(id: number): JournalTemplateGroup
}
