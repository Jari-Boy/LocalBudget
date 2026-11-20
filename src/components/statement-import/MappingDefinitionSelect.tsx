import { useMemo } from 'react'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'

export interface MappingDefinitionSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のマッピング定義。並び順はそのまま使う */
  definitions: readonly { id: number; label: string }[]
  /** 選択中の定義のid(文字列)。未選択は空文字 */
  value: string
  onChange: (value: string) => void
  /** 未選択のときにボタンに出す文言。候補には出さない */
  placeholder?: string
  disabled?: boolean
}

/**
 * 取り込みで、CSVに合うマッピング定義(CSVの読み方の設定)が複数あるときに、1つ選ぶ共通の選択欄(計画Issue #234)。
 * 候補は数個で階層は無いので、元の並び順のままフラットに並べる。検索(ひらがな/カタカナ等を区別しない)・矢印キー・
 * 1件に絞れたときのEnter確定は、部品(TreeSelect)の中で行う。
 */
export function MappingDefinitionSelect({ label, definitions, value, onChange, placeholder, disabled }: MappingDefinitionSelectProps) {
  const categories = useMemo<TreeSelectCategory[]>(
    () =>
      definitions.length === 0
        ? []
        : [
            {
              key: 'definitions',
              name: 'マッピング定義',
              nodes: definitions.map((d) => ({ kind: 'item' as const, value: String(d.id), name: d.label, isActive: true })),
            },
          ],
    [definitions],
  )
  return <TreeSelect label={label} categories={categories} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />
}
