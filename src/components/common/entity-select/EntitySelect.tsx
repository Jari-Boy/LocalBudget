import { useMemo } from 'react'
import { buildGroupSelectCategories } from '../tree-select/groupSelectCategories'
import { TreeSelect } from '../tree-select/TreeSelect'

/** グループの選択欄が受け取るグループ。科目グループのcategoryなど、絞り込みに使う項目はそのまま渡せる */
export interface EntityGroup {
  id: number
  name: string
  parentGroupId: number | null
  sortOrder: number
  isActive: boolean
  category?: string
}

export interface EntitySelectProps<G extends EntityGroup = EntityGroup> {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のもと。絞り込み条件(filter)以外の加工は画面側でしない */
  groups: readonly G[]
  /** 画面ごとの絞り込み条件(同じ区分のグループだけ、など)。合わないグループは候補に出さない */
  filter?: (group: G) => boolean
  /** 選択中のグループid。未選択はnull。非アクティブでも、現在の値は候補に残す */
  value: number | null
  onChange: (groupId: number | null) => void
  /** 渡すと、先頭に未選択の項目(値はnull)を出す */
  emptyLabel?: string
  placeholder?: string
  /** 渡すと、検索欄の直下に「+ 新規追加」を出す */
  onCreate?: () => void
  createLabel?: string
  disabled?: boolean
}

/**
 * マスタの実体(いまはグループ)を1つ選ぶ共通の選択欄(計画Issue #233)。画面ごとに候補を組み立てず、
 * グループ(groups)と絞り込み条件(filter)だけを渡す。階層のインデント・検索(ひらがな/カタカナ等を区別しない)・矢印キー・
 * 検索1件でのEnter確定・「+ 新規追加」・非アクティブの扱い(現在の値は残す)は、部品(TreeSelect)の中で行う。
 */
export function EntitySelect<G extends EntityGroup>({
  label,
  groups,
  filter,
  value,
  onChange,
  emptyLabel,
  placeholder,
  onCreate,
  createLabel,
  disabled,
}: EntitySelectProps<G>) {
  const categories = useMemo(
    () => buildGroupSelectCategories(filter === undefined ? groups : groups.filter((group) => filter(group) || group.id === value)),
    [groups, filter, value],
  )
  return (
    <TreeSelect
      label={label}
      categories={categories}
      value={value === null ? '' : String(value)}
      onChange={(next) => onChange(next === '' ? null : Number(next))}
      emptyLabel={emptyLabel}
      placeholder={placeholder ?? emptyLabel}
      onCreate={onCreate}
      createLabel={createLabel}
      disabled={disabled}
    />
  )
}
