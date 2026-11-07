import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  buildTreeTableRows,
  CATEGORY_ID_PREFIX,
  dropZoneFor,
  resolveTreeMove,
  type DropZone,
  type TreeTableCategory,
  type TreeTableNode,
} from './treeTableModel'
import './TreeTable.css'

export interface TreeTableMoveInfo {
  ids: readonly string[]
  targetId: string
  zone: DropZone
  /** 中へ移動したグループ。呼び出し側が折りたたみを解除するための情報(区分の最上位への移動では無し) */
  expandId?: string
}

export interface TreeTableProps {
  categories: readonly TreeTableCategory[]
  nodes: readonly TreeTableNode[]
  /** 「名称」の右に並べる列の見出し。各ノードのcellsと同じ順 */
  columns: readonly string[]
  checkedIds: readonly string[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCheckedChange: (ids: readonly string[]) => void
  /** 判定済みの有効な移動だけを、移動後のノード配列とともに通知する */
  onMove: (next: TreeTableNode[], info: TreeTableMoveInfo) => void
  /** 区分またぎ・自分の配下への移動など、拒否した理由を通知する */
  onMoveRejected?: (reason: string) => void
  /** 区分の見出し行の右側に差し込む操作(例: 「+ グループ」)。引数は区分のkey */
  renderCategoryActions?: (categoryKey: string) => ReactNode
}

interface DragOver {
  id: string
  zone: DropZone
}

/**
 * マスタ用のツリー表(計画Issue #150)。区分の見出し・入れ子の行・折りたたみ・複数選択・
 * ドラッグ移動を持つ。ドラッグ移動は、行の上端・下端で並び替え、グループの中央で中へ、
 * 区分の見出しで最上位へ移す。チェック済みの行をドラッグするとチェック済みの全行を、
 * そうでなければその1行だけを移す。移動の可否は純粋関数(resolveTreeMove)で判定する。
 * 表示用の汎用ノード型だけを受け取り、DB・Repositoryには依存しない。
 */
export function TreeTable({
  categories,
  nodes,
  columns,
  checkedIds,
  selectedId,
  onSelect,
  onCheckedChange,
  onMove,
  onMoveRejected,
  renderCategoryActions,
}: TreeTableProps) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const [dragOver, setDragOver] = useState<DragOver | null>(null)
  const draggingIds = useRef<readonly string[] | null>(null)

  const rows = buildTreeTableRows({ categories, nodes, collapsedIds })

  const toggleCollapsed = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleChecked = (id: string) =>
    onCheckedChange(checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id])

  const endDrag = () => {
    draggingIds.current = null
    setDragOver(null)
  }

  const handleDragStart = (event: DragEvent<HTMLTableRowElement>, id: string) => {
    draggingIds.current = checkedIds.includes(id) ? checkedIds : [id]
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleNodeDragOver = (event: DragEvent<HTMLTableRowElement>, node: TreeTableNode) => {
    if (!draggingIds.current) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const zone = dropZoneFor(node.kind === 'group', ratio)
    if (dragOver?.id !== node.id || dragOver.zone !== zone) setDragOver({ id: node.id, zone })
  }

  const handleCategoryDragOver = (event: DragEvent<HTMLTableRowElement>, key: string) => {
    if (!draggingIds.current) return
    event.preventDefault()
    const id = `${CATEGORY_ID_PREFIX}${key}`
    if (dragOver?.id !== id) setDragOver({ id, zone: 'inside' })
  }

  const handleDrop = (event: DragEvent<HTMLTableRowElement>, targetId: string) => {
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

  const colSpan = columns.length + 2

  return (
    <div className="tree-table">
      <table className="tree-table__table">
        <thead>
          <tr>
            <th className="tree-table__check-head">
              <span className="tree-table__sr-only">選択</span>
            </th>
            <th>名称</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === 'category') {
              const id = `${CATEGORY_ID_PREFIX}${row.key}`
              return (
                <tr
                  key={id}
                  className="tree-table__category"
                  data-drop-zone={dragOver?.id === id ? dragOver.zone : undefined}
                  onDragOver={(event) => handleCategoryDragOver(event, row.key)}
                  onDrop={(event) => handleDrop(event, id)}
                >
                  <td colSpan={colSpan}>
                    <div className="tree-table__category-line">
                      <span className="tree-table__category-name">{row.name}</span>
                      <span className="tree-table__count">{row.count}件</span>
                      <span className="tree-table__spacer" />
                      {renderCategoryActions?.(row.key)}
                    </div>
                  </td>
                </tr>
              )
            }
            const { node, depth, isGroup, isOpen, leafCount } = row
            const isSelected = node.id === selectedId
            return (
              <tr
                key={node.id}
                draggable
                className={`tree-table__row${isSelected ? ' tree-table__row--selected' : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                data-drop-zone={dragOver?.id === node.id ? dragOver.zone : undefined}
                onDragStart={(event) => handleDragStart(event, node.id)}
                onDragOver={(event) => handleNodeDragOver(event, node)}
                onDrop={(event) => handleDrop(event, node.id)}
                onDragEnd={endDrag}
              >
                <td className="tree-table__check">
                  <input
                    type="checkbox"
                    aria-label={`${node.name}を選択`}
                    checked={checkedIds.includes(node.id)}
                    onChange={() => toggleChecked(node.id)}
                  />
                </td>
                <td>
                  <div className="tree-table__name" style={{ paddingLeft: depth * 18 + (isGroup ? 0 : 26) }}>
                    {isGroup && (
                      <button
                        type="button"
                        className="tree-table__toggle"
                        aria-expanded={isOpen}
                        aria-label={`${node.name}を開閉`}
                        onClick={() => toggleCollapsed(node.id)}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`tree-table__link${isGroup ? ' tree-table__link--group' : ''}`}
                      onClick={() => onSelect(node.id)}
                    >
                      {node.name}
                    </button>
                    <span className="tree-table__count">
                      {isGroup ? `${leafCount}件` : (node.note ?? '')}
                    </span>
                  </div>
                </td>
                {columns.map((column, index) => (
                  <td key={column}>{node.cells[index] ?? ''}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
