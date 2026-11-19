import { useMemo } from 'react'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { buildCounterpartyTree } from './masterTreeNodes'

export interface CounterpartySelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のもと。絞り込み条件(filter)以外の加工は画面側でしない */
  counterparties: readonly Counterparty[]
  counterpartyGroups: readonly CounterpartyGroup[]
  /** 画面ごとの絞り込み条件(有効な取引先だけ、など)。合わない取引先は候補に出さない。呼び出し側で安定した参照にする */
  filter?: (counterparty: Counterparty) => boolean
  /** 選択中の取引先のid(文字列)。未選択は空文字。leadingOptionsの値も入る。filterに合わなくても、現在の値の取引先は候補に残す */
  value: string
  onChange: (value: string) => void
  /** 渡すと、先頭に未選択の項目(値は空文字)を出す */
  emptyLabel?: string
  /** 実体ではない特別な項目(「変更しない」など)。先頭に固定し、検索中も消えない。値は取引先のidと重ならない文字列にする。安定した参照にする */
  leadingOptions?: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}

/**
 * 取引先を1つ選ぶ共通の選択欄(計画Issue #234。AccountSelectの取引先版)。画面ごとに候補を組み立てず、
 * 取引先・グループと絞り込み条件(filter)だけを渡す。グループの階層・検索(ひらがな/カタカナ等を区別しない)・
 * Enter確定・非アクティブの扱いは、部品(TreeSelect)の中で行う。
 */
export function CounterpartySelect({
  label,
  counterparties,
  counterpartyGroups,
  filter,
  value,
  onChange,
  emptyLabel,
  leadingOptions,
  placeholder,
  disabled,
}: CounterpartySelectProps) {
  const categories = useMemo(() => {
    const candidates = filter === undefined ? counterparties : counterparties.filter((c) => filter(c) || String(c.id) === value)
    const tree = buildCounterpartyTree({ groups: counterpartyGroups, counterparties: candidates, patternCountById: new Map() })
    const inactive = new Set(candidates.filter((c) => !c.isActive).map((c) => c.id))
    return buildTreeSelectCategories(tree, inactive).filter((category) => category.nodes.length > 0)
  }, [counterparties, counterpartyGroups, filter, value])
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
