/**
 * groupMappingDefinitionsByInstitution(マスタ「明細マッピング」タブの一覧を金融機関名で
 * グループ化する純粋関数、計画Issue #183)のユニットテスト。
 * 同じ金融機関名(表記ゆれは正規化してそろえる)の定義を1グループにまとめ、グループは金融機関名の
 * 照合順、グループ内は確定→速報→区別なしの順(同じ区分はid順)に並ぶことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { groupMappingDefinitionsByInstitution } from './groupMappingDefinitionsByInstitution'

function definition(id: number, formatGroupId: string, isSettled: boolean | null): ImportMappingDefinition {
  return { id, formatGroupId, isSettled, label: `定義${id}` } as ImportMappingDefinition
}

describe('groupMappingDefinitionsByInstitution', () => {
  it('同じ金融機関名の定義を1グループにまとめ、グループは金融機関名の照合順に並ぶ', () => {
    const groups = groupMappingDefinitionsByInstitution([
      definition(1, 'ゆうちょ', null),
      definition(2, 'あおぞら', null),
      definition(3, 'ゆうちょ', true),
    ])

    expect(groups.map((g) => g.name)).toEqual(['あおぞら', 'ゆうちょ'])
    expect(groups[1].definitions.map((d) => d.id)).toEqual([3, 1])
  })

  it('グループ内は確定→速報→区別なしの順に並び、同じ区分ならid順になる', () => {
    const groups = groupMappingDefinitionsByInstitution([
      definition(5, '楽天カード', null),
      definition(4, '楽天カード', false),
      definition(3, '楽天カード', true),
      definition(2, '楽天カード', true),
    ])

    expect(groups[0].definitions.map((d) => d.id)).toEqual([2, 3, 4, 5])
  })

  it('金融機関名の表記ゆれ(全角半角・空白)は同じグループにまとめる', () => {
    const groups = groupMappingDefinitionsByInstitution([definition(1, 'PayPayカード', true), definition(2, 'ＰａｙＰａｙ カード', false)])

    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('PayPayカード')
  })

  it('定義が無ければ空配列を返す', () => {
    expect(groupMappingDefinitionsByInstitution([])).toEqual([])
  })
})
