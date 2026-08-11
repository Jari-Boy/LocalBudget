import type { Database } from 'sql.js'
import { SqlJsImportMappingDefinitionRepository } from './SqlJsImportMappingDefinitionRepository'
import { BUILT_IN_MAPPING_DEFINITIONS } from './builtInMappingDefinitions'

/**
 * 組み込みマッピング定義(docs/domain/statement-import.md 2.3節)をDBへ投入する。
 * account_id IS NULLの既存定義とformat_group_id・is_settledの組み合わせで重複を判定し、
 * 既に存在する組み合わせ(ユーザーが編集・独自作成した定義を含む)は再投入しない。
 * Worker起動のたびに呼ばれても冪等であり、db.worker.tsからrunMigrations直後に呼び出す。
 */
export function seedBuiltInMappingDefinitions(db: Database): void {
  const repository = new SqlJsImportMappingDefinitionRepository(db)
  const existingKeys = new Set(
    repository
      .findAll()
      .filter((definition) => definition.accountId === null)
      .map((definition) => seedKey(definition.formatGroupId, definition.isSettled)),
  )

  for (const input of BUILT_IN_MAPPING_DEFINITIONS) {
    if (existingKeys.has(seedKey(input.formatGroupId, input.isSettled ?? null))) continue
    repository.create(input)
  }
}

function seedKey(formatGroupId: string, isSettled: boolean | null | undefined): string {
  return `${formatGroupId}:${isSettled ?? null}`
}
