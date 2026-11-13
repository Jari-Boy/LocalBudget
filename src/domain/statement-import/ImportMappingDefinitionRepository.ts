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
 * 対応する科目(accountIds)は中間テーブルimport_mapping_definition_accountsで多対多に持つ。
 */
export interface ImportMappingDefinitionRepository {
  create(input: CreateImportMappingDefinitionInput): ImportMappingDefinition
  findById(id: number): ImportMappingDefinition | null
  findAll(): ImportMappingDefinition[]
  update(id: number, input: UpdateImportMappingDefinitionInput): ImportMappingDefinition
  delete(id: number): void

  /**
   * 取込先の科目で選べる定義として、全定義を返す。紐づけは制限ではなく優先順位なので、
   * accountIdに紐づく定義を先頭(id順)に、残りをid順に並べる。紐づく定義がなければ、
   * 全定義がid順に並ぶ(docs/domain/statement-import.md 1.5 手順1・2.3参照)。
   */
  findAvailableForAccount(accountId: number): ImportMappingDefinition[]

  /** 定義と科目の紐づけを追加する。すでに紐づいていれば何もしない(冪等)。 */
  linkAccount(definitionId: number, accountId: number): void

  /**
   * 定義と科目の紐づけを解除する。指定した1組だけを削除し、定義・科目そのもの、他の科目や
   * 他の定義との紐づけは変えない。紐づいていなければ何もしない(冪等)。
   * 科目マスタから、他の科目の紐づけを巻き込まずに解除するために使う(計画Issue #189)。
   */
  unlinkAccount(definitionId: number, accountId: number): void
}
