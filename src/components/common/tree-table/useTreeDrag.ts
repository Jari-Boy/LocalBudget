import { useRef, useState, type DragEvent } from 'react'
import {
  CATEGORY_ID_PREFIX,
  countCheckedItems,
  dropZoneFor,
  resolveTreeMove,
  topLevelIds,
  withDescendants,
  type DropZone,
  type TreeTableNode,
} from './treeTableModel'

export interface TreeMoveInfo {
  ids: readonly string[]
  targetId: string
  zone: DropZone
  /** 中へ移動したグループ。呼び出し側が折りたたみを解除するための情報(区分の最上位への移動では無し) */
  expandId?: string
}

export interface TreeDragOver {
  id: string
  zone: DropZone
}

export interface UseTreeDragParams {
  nodes: readonly TreeTableNode[]
  /** チェック済みの行をドラッグしたときは、チェック済みの全行を移す。チェックの無い表示では空 */
  checkedIds: readonly string[]
  /** 判定済みの有効な移動だけを、移動後のノード配列とともに通知する */
  onMove: (next: TreeTableNode[], info: TreeMoveInfo) => void
  /** 区分またぎ・自分の配下への移動など、拒否した理由を通知する */
  onMoveRejected?: (reason: string) => void
}

/** 複数の行を移すとき、ドラッグ中に指に付ける「N件を移動」の表示を作って、ドラッグ画像にする(計画Issue #235 E) */
function setCountDragImage(event: DragEvent<HTMLElement>, count: number) {
  const setDragImage = event.dataTransfer.setDragImage
  if (typeof setDragImage !== 'function') return
  const badge = document.createElement('div')
  badge.className = 'tree-table__drag-badge'
  badge.textContent = `${count}件を移動`
  document.body.appendChild(badge)
  setDragImage.call(event.dataTransfer, badge, 12, 12)
  // ドラッグ画像はドラッグ開始の瞬間に取り込まれるため、次のタスクで取り除いてよい
  setTimeout(() => badge.remove(), 0)
}

/**
 * ツリーのドラッグ移動の状態と操作(計画Issue #150のTreeTableから、計画Issue #201でカード型の一覧
 * (TreeCardList)と共有するために切り出した)。行の上端・下端で並び替え、グループの中央で中へ、区分の
 * 見出しで最上位へ移す。チェック済みの行をドラッグするとチェック済みの全行を、そうでなければその1行だけを移す
 * (チェックしていない行をつかんだときは、チェックはそのままで、つかんだ行だけを移す)。グループとその配下を同時に
 * チェックしているとき(グループのチェックは配下に連動する)は、グループ1件として配下ごと移す。
 * 複数の行を移すときは、ドラッグ中に「N件を移動」の表示を付け、移す行(グループなら配下も)を薄く表示する(計画Issue #235 E)。
 * 移動の可否は純粋関数(resolveTreeMove)で判定する。DOMの要素の種類(表の行・リストの項目)には依存しない。
 */
export function useTreeDrag({ nodes, checkedIds, onMove, onMoveRejected }: UseTreeDragParams) {
  const [dragOver, setDragOver] = useState<TreeDragOver | null>(null)
  /** ドラッグ中に薄く表示する行(移す行と、その配下) */
  const [dimmedIds, setDimmedIds] = useState<readonly string[] | null>(null)
  const draggingIds = useRef<readonly string[] | null>(null)
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const endDrag = () => {
    draggingIds.current = null
    if (dimTimer.current !== null) clearTimeout(dimTimer.current)
    dimTimer.current = null
    setDimmedIds(null)
    setDragOver(null)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, id: string) => {
    const moving = checkedIds.includes(id) ? topLevelIds(nodes, checkedIds) : [id]
    draggingIds.current = moving
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    const affected = withDescendants(nodes, moving)
    const count = countCheckedItems(nodes, affected)
    if (count > 1) setCountDragImage(event, count)
    // ドラッグ開始と同時に表示を変えると、ドラッグが取り消されるブラウザがあるため、薄い表示は次のタスクで付ける
    dimTimer.current = setTimeout(() => setDimmedIds(affected), 0)
  }

  const handleNodeDragOver = (event: DragEvent<HTMLElement>, node: TreeTableNode) => {
    if (!draggingIds.current) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const zone = dropZoneFor(node.kind === 'group', ratio)
    if (dragOver?.id !== node.id || dragOver.zone !== zone) setDragOver({ id: node.id, zone })
  }

  const handleCategoryDragOver = (event: DragEvent<HTMLElement>, key: string) => {
    if (!draggingIds.current) return
    event.preventDefault()
    const id = `${CATEGORY_ID_PREFIX}${key}`
    if (dragOver?.id !== id) setDragOver({ id, zone: 'inside' })
  }

  const handleDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault()
    const ids = draggingIds.current
    const over = dragOver
    endDrag()
    if (!ids || ids.length === 0 || over?.id !== targetId) return
    const result = resolveTreeMove(nodes, ids, { id: targetId, zone: over.zone })
    if (!result.ok) {
      onMoveRejected?.(result.reason)
      return
    }
    onMove(result.nodes, { ids, targetId, zone: over.zone, expandId: result.expandId })
  }

  return { dragOver, dimmedIds, endDrag, handleDragStart, handleNodeDragOver, handleCategoryDragOver, handleDrop }
}
