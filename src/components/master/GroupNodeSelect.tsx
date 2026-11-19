import { useMemo } from 'react'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { buildGroupNodeCategories, decodeGroupNodeValue, encodeGroupNodeValue } from './groupNodeSelectCategories'

export interface GroupNodeSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** マスタの表のノード(グループと葉)。グループだけを候補にする */
  nodes: readonly TreeTableNode[]
  /** 渡すと、その区分のグループだけを候補にする(勘定科目の区分) */
  categoryKey?: string
  /** 候補に出さないノードのid(自分自身と配下、移動する行とその配下など)。参照は呼び出し側で安定させる必要は無い */
  excludedIds: readonly string[]
  /** 区分の最上位(グループなし)のノードid。「cat:区分」。先頭に固定して出す */
  topId: string
  topLabel: string
  /** 現在の値。グループのノードid、topId、または未選択の空文字 */
  value: string
  /** 選んだ値(グループのノードid、またはtopId)を通知する */
  onChange: (value: string) => void
  /** 値が空のときにボタンへ出す文言(一括移動の「選択してください」) */
  placeholder?: string
  disabled?: boolean
}

/**
 * 親グループ・所属グループ・移動先を1つ選ぶ、ツリーのノード用の共通の選択欄(計画Issue #234。グループの選択欄)。
 * マスタの各画面がノードの配列とidで動いているため、グループの配列ではなくノードを受け取り、値もノードidで受け渡す。
 * 区分の最上位は特別な項目として先頭に固定し、グループは階層(インデントと開閉)・検索・Enter確定つきで出す。
 */
export function GroupNodeSelect({ label, nodes, categoryKey, excludedIds, topId, topLabel, value, onChange, placeholder, disabled }: GroupNodeSelectProps) {
  const excludedKey = excludedIds.join(',')
  const categories = useMemo(
    () => buildGroupNodeCategories({ nodes, categoryKey, excludedIds: excludedKey === '' ? [] : excludedKey.split(',') }),
    [nodes, categoryKey, excludedKey],
  )
  const leadingOptions = useMemo(() => [{ value: topId, label: topLabel }], [topId, topLabel])
  return (
    <TreeSelect
      label={label}
      categories={categories}
      value={value === '' || value === topId ? value : encodeGroupNodeValue(value)}
      onChange={(next) => onChange(decodeGroupNodeValue(next))}
      leadingOptions={leadingOptions}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}
