import type {
  CreateImportMappingDefinitionInput,
  ImportMappingDefinition,
  UpdateImportMappingDefinitionInput,
} from './ImportMappingDefinition'

/**
 * マッピング定義(import_mapping_definitions)の永続化を担うRepositoryのポート(インターフェース)。
 * amount_mode(single_signed/debit_credit_split)に応じた列指定の整合性はDDL側のCHECK制約
 * (docs/schema/statement_import.sql)で強制されるため、実装(インフラ層)は制約違反時の例外を
 * そのまま呼び出し元に伝播させる(docs/domain/statement-import.md 2章参照)。
 */
export interface ImportMappingDefinitionRepository {
  create(input: CreateImportMappingDefinitionInput): ImportMappingDefinition
  findById(id: number): ImportMappingDefinition | null
  findAll(): ImportMappingDefinition[]
  update(id: number, input: UpdateImportMappingDefinitionInput): ImportMappingDefinition
  delete(id: number): void

  /**
   * accountIdに紐づく専用定義と、まだどの科目にも紐づいていない汎用定義(account_id IS NULL)を
   * あわせて返す。取込対象科目を選んだ際の定義選択候補の一覧に使う
   * (docs/domain/statement-import.md 1.5 手順1・2.3参照)。
   */
  findAvailableForAccount(accountId: number): ImportMappingDefinition[]
}
