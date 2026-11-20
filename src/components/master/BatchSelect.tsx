import { useMemo } from 'react'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'

export interface BatchSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のもと。絞り込み条件(filter)以外の加工は画面側でしない。並び順はそのまま使う */
  batches: readonly SettlementBatch[]
  /** 画面ごとの絞り込み条件。合わないバッチは候補に出さない(現在の値は残す)。呼び出し側で安定した参照にする */
  filter?: (batch: SettlementBatch) => boolean
  /** 選択中のバッチのid(文字列)。未選択は空文字。leadingOptionsの値も入る */
  value: string
  onChange: (value: string) => void
  /** 渡すと、先頭に未選択の項目(値は空文字)を出す(「精算バッチなし」「変更しない」など) */
  emptyLabel?: string
  /** 実体ではない特別な項目(「なし(外す)」「新しいバッチを作成」など)。先頭に固定し、検索中も消えない。値はバッチのidと重ならない文字列にする。安定した参照にする */
  leadingOptions?: readonly { value: string; label: string }[]
  placeholder?: string
  /** 渡すと、検索欄の直下に「+ 新規追加」の操作を出す。押すと選択欄を閉じてこれを呼ぶ(値は変えない) */
  onCreate?: () => void
  /** 「+ 」の後ろに出す文言。既定は「新規追加」 */
  createLabel?: string
  disabled?: boolean
}

/**
 * 精算バッチを1つ選ぶ共通の選択欄(計画Issue #234。MemberSelect・CounterpartySelectのバッチ版)。
 * 画面ごとに候補を組み立てず、バッチと絞り込み条件(filter)だけを渡す。バッチに階層は無いので、元の並び順のまま
 * フラットに並べる。検索(ひらがな/カタカナ等を区別しない)・矢印キー・1件に絞れたときのEnter確定・「+ 新規追加」は、
 * 部品(TreeSelect)の中で行う。現在の値のバッチは、filterに合わなくても候補に残す。
 */
export function BatchSelect({
  label,
  batches,
  filter,
  value,
  onChange,
  emptyLabel,
  leadingOptions,
  placeholder,
  onCreate,
  createLabel,
  disabled,
}: BatchSelectProps) {
  const categories = useMemo<TreeSelectCategory[]>(() => {
    const candidates = batches.filter((b) => String(b.id) === value || filter === undefined || filter(b))
    if (candidates.length === 0) return []
    return [
      {
        key: 'batches',
        name: '精算バッチ',
        nodes: candidates.map((b) => ({ kind: 'item' as const, value: String(b.id), name: b.name, isActive: true })),
      },
    ]
  }, [batches, filter, value])
  return (
    <TreeSelect
      label={label}
      categories={categories}
      value={value}
      onChange={onChange}
      emptyLabel={emptyLabel}
      leadingOptions={leadingOptions}
      placeholder={placeholder ?? emptyLabel}
      onCreate={onCreate}
      createLabel={createLabel}
      disabled={disabled}
    />
  )
}
