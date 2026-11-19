import { useMemo } from 'react'
import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { buildAccountTree } from './masterTreeNodes'

export interface AccountSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル) */
  label: string
  /** 候補のもと。絞り込み条件(filter)以外の加工は画面側でしない */
  accounts: readonly Account[]
  accountGroups: readonly AccountGroup[]
  /** 画面ごとの絞り込み条件(有効な科目だけ、システム管理の科目を除く、など)。合わない科目は候補に出さない */
  filter?: (account: Account) => boolean
  /** 選択中の科目のid(文字列)。未選択は空文字。leadingOptionsの値も入る。filterに合わなくても、現在の値の科目は候補に残す */
  value: string
  onChange: (value: string) => void
  /** 渡すと、先頭に未選択の項目(値は空文字)を出す */
  emptyLabel?: string
  /** 実体ではない特別な項目(「変更しない」など)。先頭に固定し、検索中も消えない。値は科目のidと重ならない文字列にする */
  leadingOptions?: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  /**
   * 該当する科目を、階層ではなく先頭の見出し(name)の下にまとめて出す(取込先の「このマッピングに紐づく科目」など)。
   * 階層のほうには重ねて出さない。該当が無ければ見出しも出さない
   */
  pinned?: { name: string; filter: (account: Account) => boolean }
}

/**
 * 科目を1つ選ぶ共通の選択欄(計画Issue #234。マスタの実体を選ぶ共通の選択欄 EntitySelect の、科目の種類)。
 * 画面ごとに候補を組み立てず、科目・グループと絞り込み条件(filter)だけを渡す。区分ごとの見出し・グループの階層・
 * 検索(ひらがな/カタカナ等を区別しない)・Enter確定・非アクティブの扱いは、部品(TreeSelect)の中で行う。
 */
export function AccountSelect({
  label,
  accounts,
  accountGroups,
  filter,
  value,
  onChange,
  emptyLabel,
  leadingOptions,
  placeholder,
  disabled,
  pinned,
}: AccountSelectProps) {
  const categories = useMemo(() => {
    const candidates = filter === undefined ? accounts : accounts.filter((a) => filter(a) || String(a.id) === value)
    const pinnedAccounts = pinned === undefined ? [] : candidates.filter(pinned.filter)
    const pinnedIds = new Set(pinnedAccounts.map((a) => a.id))
    const rest = candidates.filter((a) => !pinnedIds.has(a.id))
    const tree = buildAccountTree({ groups: accountGroups, accounts: rest, memberNameById: new Map() })
    const inactive = new Set(candidates.filter((a) => !a.isActive).map((a) => a.id))
    const hierarchy = buildTreeSelectCategories(tree, inactive).filter((category) => category.nodes.length > 0)
    if (pinned === undefined || pinnedAccounts.length === 0) return hierarchy
    const pinnedCategory: TreeSelectCategory = {
      key: 'pinned',
      name: pinned.name,
      nodes: pinnedAccounts.map((a) => ({ kind: 'item', value: String(a.id), name: a.name, isActive: a.isActive })),
    }
    return [pinnedCategory, ...hierarchy]
  }, [accounts, accountGroups, filter, value, pinned])
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
