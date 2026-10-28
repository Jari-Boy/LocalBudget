import type { Account } from '../account/Account'
import type { AccountGroup } from './AccountGroup'
import { isDescendantGroup } from './isDescendantGroup'

export interface AccountGroupNodeRef {
  kind: 'group' | 'account'
  id: number
}

export interface AccountGroupDropTarget extends AccountGroupNodeRef {
  /** 'before'/'after' = targetと同じ入れ物の中で兄弟として挿入(階層は変えない)。
   * 'inside' = targetの中へネスト(子にする、targetがgroupの場合のみ有効)。 */
  zone: 'before' | 'after' | 'inside'
}

export interface AccountGroupDropResult {
  /** groupId → 反映すべきフィールドの差分(指定されたキーのみ更新する) */
  groupUpdates: Map<number, { parentGroupId?: number | null; sortOrder?: number }>
  accountUpdates: Map<number, { accountGroupId?: number | null; sortOrder?: number }>
}

interface ContainerEntry {
  kind: 'group' | 'account'
  id: number
  sortOrder: number
}

function containerOf(
  kind: 'group' | 'account',
  item: AccountGroup | Account,
): { containerId: number | null; category: string } {
  if (kind === 'account') {
    const account = item as Account
    return { containerId: account.accountGroupId, category: account.category }
  }
  const group = item as AccountGroup
  return { containerId: group.parentGroupId, category: group.category }
}

function findItem(
  groups: readonly AccountGroup[],
  accounts: readonly Account[],
  ref: AccountGroupNodeRef,
): AccountGroup | Account | undefined {
  return ref.kind === 'group' ? groups.find((g) => g.id === ref.id) : accounts.find((a) => a.id === ref.id)
}

function containerEntries(
  groups: readonly AccountGroup[],
  accounts: readonly Account[],
  containerId: number | null,
  category: string,
): ContainerEntry[] {
  const groupEntries: ContainerEntry[] = (
    containerId === null
      ? groups.filter((g) => g.parentGroupId === null && g.category === category)
      : groups.filter((g) => g.parentGroupId === containerId)
  ).map((g) => ({ kind: 'group', id: g.id, sortOrder: g.sortOrder }))
  const accountEntries: ContainerEntry[] =
    containerId === null
      ? []
      : accounts
          .filter((a) => a.accountGroupId === containerId)
          .map((a) => ({ kind: 'account', id: a.id, sortOrder: a.sortOrder }))
  return [...groupEntries, ...accountEntries].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * ドラッグ&ドロップ(3ゾーン方式)の結果を判定する純粋関数(計画Issue #129)。
 * draggedをtargetのゾーンに応じて「兄弟として挿入(before/after、階層は変えない)」
 * または「子としてネスト(inside、targetがgroupの場合のみ)」する。
 * category不一致・循環参照・科目をルートへ挿入しようとする操作は無効としてnullを返す。
 * before/afterでは、挿入先の入れ物(親グループ、最上位ならcategory)に属する
 * サブグループ+直属科目をsortOrderで再採番し、実際に値が変わったものだけを
 * 戻り値のMapに含める(無駄な更新を避けるため)。DB非依存。
 */
export function resolveAccountGroupDrop(
  groups: readonly AccountGroup[],
  accounts: readonly Account[],
  dragged: AccountGroupNodeRef,
  target: AccountGroupDropTarget,
): AccountGroupDropResult | null {
  if (dragged.kind === target.kind && dragged.id === target.id) return null

  const draggedItem = findItem(groups, accounts, dragged)
  const targetItem = findItem(groups, accounts, target)
  if (!draggedItem || !targetItem) return null

  const draggedCategory = containerOf(dragged.kind, draggedItem).category
  const targetCategory = containerOf(target.kind, targetItem).category
  if (draggedCategory !== targetCategory) return null

  if (target.zone === 'inside' && target.kind !== 'group') return null

  const destContainerId =
    target.zone === 'inside' ? target.id : containerOf(target.kind, targetItem).containerId

  if (destContainerId === null && dragged.kind === 'account') return null

  if (dragged.kind === 'group') {
    if (destContainerId !== null && isDescendantGroup(groups, dragged.id, destContainerId)) return null
    if (destContainerId === dragged.id) return null
  }

  const groupUpdates = new Map<number, { parentGroupId?: number | null; sortOrder?: number }>()
  const accountUpdates = new Map<number, { accountGroupId?: number | null; sortOrder?: number }>()

  if (target.zone === 'inside') {
    const siblingOrders = containerEntries(groups, accounts, destContainerId, targetCategory).map(
      (e) => e.sortOrder,
    )
    const nextOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0
    if (dragged.kind === 'group') {
      groupUpdates.set(dragged.id, { parentGroupId: destContainerId, sortOrder: nextOrder })
    } else {
      accountUpdates.set(dragged.id, { accountGroupId: destContainerId, sortOrder: nextOrder })
    }
    return { groupUpdates, accountUpdates }
  }

  // before / after: 挿入先の入れ物に属する全員(サブグループ+直属科目)を集めて並び替える
  const draggedKey = dragged.kind + '-' + dragged.id
  const targetKey = target.kind + '-' + target.id

  const currentEntries = containerEntries(groups, accounts, destContainerId, targetCategory)
  const alreadyInContainer = currentEntries.some((e) => e.kind === dragged.kind && e.id === dragged.id)
  const combined: ContainerEntry[] = alreadyInContainer
    ? currentEntries
    : [...currentEntries, { kind: dragged.kind, id: dragged.id, sortOrder: Number.POSITIVE_INFINITY }].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      )

  const draggedIdx = combined.findIndex((e) => e.kind + '-' + e.id === draggedKey)
  const targetIdx = combined.findIndex((e) => e.kind + '-' + e.id === targetKey)
  if (draggedIdx === -1 || targetIdx === -1) return null

  if (alreadyInContainer) {
    if (target.zone === 'before' && draggedIdx === targetIdx - 1) {
      return { groupUpdates, accountUpdates }
    }
    if (target.zone === 'after' && draggedIdx === targetIdx + 1) {
      return { groupUpdates, accountUpdates }
    }
  }

  const withoutDragged = combined.slice(0, draggedIdx).concat(combined.slice(draggedIdx + 1))
  const newTargetIdx = withoutDragged.findIndex((e) => e.kind + '-' + e.id === targetKey)
  const insertAt = target.zone === 'before' ? newTargetIdx : newTargetIdx + 1
  const reordered = withoutDragged
    .slice(0, insertAt)
    .concat([{ kind: dragged.kind, id: dragged.id, sortOrder: 0 }], withoutDragged.slice(insertAt))

  reordered.forEach((entry, index) => {
    const isDraggedEntry = entry.kind === dragged.kind && entry.id === dragged.id

    if (isDraggedEntry) {
      const needsContainerChange = !alreadyInContainer
      if (entry.kind === 'group') {
        groupUpdates.set(entry.id, {
          ...(needsContainerChange ? { parentGroupId: destContainerId } : {}),
          sortOrder: index,
        })
      } else {
        accountUpdates.set(entry.id, {
          ...(needsContainerChange ? { accountGroupId: destContainerId } : {}),
          sortOrder: index,
        })
      }
      return
    }

    if (entry.sortOrder === index) return

    if (entry.kind === 'group') {
      groupUpdates.set(entry.id, { sortOrder: index })
    } else {
      accountUpdates.set(entry.id, { sortOrder: index })
    }
  })

  return { groupUpdates, accountUpdates }
}
