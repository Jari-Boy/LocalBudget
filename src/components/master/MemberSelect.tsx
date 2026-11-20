import { useMemo } from 'react'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'

export interface MemberSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のもと。絞り込み条件(filter)以外の加工は画面側でしない */
  members: readonly HouseholdMember[]
  /** 画面ごとの絞り込み条件(個人のメンバーだけ、など)。合わないメンバーは候補に出さない。呼び出し側で安定した参照にする */
  filter?: (member: HouseholdMember) => boolean
  /** 選択中のメンバーのid(文字列)。未選択は空文字。leadingOptionsの値も入る。無効でも、現在の値のメンバーは候補に残す */
  value: string
  onChange: (value: string) => void
  /** 渡すと、先頭に未選択の項目(値は空文字)を出す */
  emptyLabel?: string
  /** 実体ではない特別な項目(「起票者なし」「変更しない」など)。先頭に固定し、検索中も消えない。値はメンバーのidと重ならない文字列にする。安定した参照にする */
  leadingOptions?: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}

/**
 * 世帯メンバーを1つ選ぶ共通の選択欄(計画Issue #234。AccountSelect・CounterpartySelectのメンバー版)。
 * 画面ごとに候補を組み立てず、メンバーと絞り込み条件(filter)だけを渡す。メンバーに階層は無いので、フラットに並べる。
 * 検索(ひらがな/カタカナ等を区別しない)・矢印キー・1件に絞れたときのEnter確定は、部品(TreeSelect)の中で行う。
 * 無効なメンバーは、現在の値のときだけ候補に残す(新しく選べない)。
 */
export function MemberSelect({ label, members, filter, value, onChange, emptyLabel, leadingOptions, placeholder, disabled }: MemberSelectProps) {
  const categories = useMemo<TreeSelectCategory[]>(() => {
    const candidates = members.filter((m) => String(m.id) === value || (m.isActive && (filter === undefined || filter(m))))
    if (candidates.length === 0) return []
    return [
      {
        key: 'members',
        name: '世帯メンバー',
        nodes: candidates.map((m) => ({ kind: 'item' as const, value: String(m.id), name: m.name, isActive: m.isActive })),
      },
    ]
  }, [members, filter, value])
  return (
    <TreeSelect
      label={label}
      categories={categories}
      value={value}
      onChange={onChange}
      emptyLabel={emptyLabel}
      leadingOptions={leadingOptions}
      placeholder={placeholder ?? emptyLabel}
      disabled={disabled}
    />
  )
}
