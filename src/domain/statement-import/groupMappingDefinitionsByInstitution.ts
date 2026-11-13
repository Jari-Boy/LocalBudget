import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { normalizeFinancialInstitutionName } from './financialInstitution'

export interface MappingDefinitionGroup {
  /** 金融機関名(正規化済み) */
  name: string
  definitions: ImportMappingDefinition[]
}

/** グループ内の並び順: 確定 → 速報 → 区別なし */
function settledRank(isSettled: boolean | null): number {
  return isSettled === true ? 0 : isSettled === false ? 1 : 2
}

/**
 * マスタ「明細マッピング」タブの一覧用に、定義を金融機関名(format_group_id)でグループ化する
 * (計画Issue #183)。グループは金融機関名の照合順、グループ内は確定→速報→区別なしの順(同じ区分はid順)。
 */
export function groupMappingDefinitionsByInstitution(
  definitions: readonly ImportMappingDefinition[],
): MappingDefinitionGroup[] {
  const byName = new Map<string, ImportMappingDefinition[]>()
  for (const definition of definitions) {
    const name = normalizeFinancialInstitutionName(definition.formatGroupId)
    byName.set(name, [...(byName.get(name) ?? []), definition])
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([name, items]) => ({
      name,
      definitions: items.sort((a, b) => settledRank(a.isSettled) - settledRank(b.isSettled) || a.id - b.id),
    }))
}
