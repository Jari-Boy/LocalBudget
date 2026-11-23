import { useState, type ReactNode } from 'react'
import { useEscapeToClear } from '../range-selection/useEscapeToClear'
import { useRangeSelection } from '../range-selection/useRangeSelection'
import {
  buildTreeTableRows,
  CATEGORY_ID_PREFIX,
  reconcileTreeChecked,
  type TreeTableCategory,
  type TreeTableNode,
} from './treeTableModel'
import { StickyHeaderTable } from '../sticky/StickyHeaderTable'
import { useTreeDrag, type TreeMoveInfo } from './useTreeDrag'
import './TreeTable.css'

/** ドラッグ移動の通知の情報(useTreeDragと共通) */
export type TreeTableMoveInfo = TreeMoveInfo

export interface TreeTableProps {
  categories: readonly TreeTableCategory[]
  nodes: readonly TreeTableNode[]
  /**
   * グループのチェックを配下に連動させる計算(reconcileTreeChecked)に使うノード。既定は nodes。検索などで nodes を絞り込んで
   * 渡す画面は、絞り込み前の全ノードを渡す(絞り込みで隠れている配下も、グループのチェックに連動させ、グループのチェックが
   * 「配下すべてがチェック済み」の意味を保つため。計画Issue #235 E)。範囲選択と「すべて選択」は、表示中の行が対象のまま
   */
  cascadeNodes?: readonly TreeTableNode[]
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
  /** 先頭の列(既定は「名称」)の見出し。例: キーワードタブでは「キーワード」(計画Issue #219) */
  nameColumn?: string
  /**
   * 渡すと、列見出しが押せるボタンになり、現在の並び替えの列(名称列は'name'、他はcolumnsの番号)に
   * aria-sortと小さい▲▼を付ける。並び替えそのものは呼び出し側が行い、押した列をonSortChangeで通知する
   */
  sort?: { column: 'name' | number; direction: 'asc' | 'desc' }
  onSortChange?: (column: 'name' | number) => void
  /** falseにすると区分の見出し行(区分名と件数)を出さない。区分が1つしかない平らな一覧向け(計画Issue #219)。既定はtrue */
  showCategoryRows?: boolean
  /** falseにすると行をドラッグできない(並び順を持たない平らな一覧向け)。既定はtrue */
  draggable?: boolean
  /**
   * 葉の行(グループの行ではない)の名称の左に差し込む操作。マスタ画面のお気に入りの★に使う(計画Issue #231 フェーズ4)。
   * 差し込む側が、押しても行の選択を起こさないボタンにする。表示用の汎用ノード型だけを渡す
   */
  renderLeafLeading?: (node: TreeTableNode) => ReactNode
}

/**
 * マスタ用のツリー表(計画Issue #150)。区分の見出し・入れ子の行・折りたたみ・複数選択・
 * ドラッグ移動を持つ。ドラッグ移動は、行の上端・下端で並び替え、グループの中央で中へ、
 * 区分の見出しで最上位へ移す。チェック済みの行をドラッグするとチェック済みの全行を、
 * そうでなければその1行だけを移す。移動の可否は純粋関数(resolveTreeMove)で判定する。
 * ドラッグを使えない場合の移動先選択は、2件以上チェックしたときの右パネル(BulkSelectionPanel)が
 * 同じ判定で担う。表示用の汎用ノード型だけを受け取り、DB・Repositoryには依存しない。
 */
export function TreeTable({
  categories,
  nodes,
  cascadeNodes,
  columns,
  checkedIds,
  selectedId,
  onSelect,
  onCheckedChange,
  onMove,
  onMoveRejected,
  renderCategoryActions,
  nameColumn = '名称',
  sort,
  onSortChange,
  draggable = true,
  showCategoryRows = true,
  renderLeafLeading,
}: TreeTableProps) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const { dragOver, dimmedIds, endDrag, handleDragStart, handleNodeDragOver, handleCategoryDragOver, handleDrop } = useTreeDrag({
    nodes,
    checkedIds,
    onMove,
    onMoveRejected,
  })

  const rows = buildTreeTableRows({ categories, nodes, collapsedIds })

  const toggleCollapsed = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const colSpan = columns.length + 2

  /** ヘッダーの「すべて選択」と範囲選択の対象: 表示中(折りたたみで隠れていない)の全行 */
  const visibleIds = rows.flatMap((row) => (row.type === 'node' ? [row.node.id] : []))
  // 行のチェックの Shift+クリック(範囲選択)・Ctrl/Cmd+クリック(トグル)・Shift+↑↓(計画Issue #235 D)。範囲は表示中の行だけ
  // チェックの変更は、グループのチェックを配下に連動させてから親へ渡す(計画Issue #235 E)。グループにチェックを付けると配下
  // (折りたたみで隠れた行も)すべてに付き、配下の一部を外すとグループも外れ、配下がすべてそろえばグループにも付く
  const changeChecked = (next: readonly string[]) => onCheckedChange(reconcileTreeChecked(cascadeNodes ?? nodes, checkedIds, next))
  const range = useRangeSelection<string>({ order: visibleIds, selected: checkedIds, onChange: changeChecked })
  // Esc でチェックをすべて外す(計画Issue #235 D)
  useEscapeToClear(checkedIds.length > 0 ? () => onCheckedChange([]) : null)
  const checkedVisibleCount = visibleIds.filter((id) => checkedIds.includes(id)).length
  const allChecked = visibleIds.length > 0 && checkedVisibleCount === visibleIds.length
  const toggleAll = () => changeChecked(allChecked ? [] : visibleIds)

  /** 列見出し。sortを渡したときだけ押せるボタンにし、並び替え中の列に小さい▲▼を付ける */
  const renderHeader = (column: 'name' | number, label: string) => {
    if (!sort) return <th key={String(column)}>{label}</th>
    const active = sort.column === column
    return (
      <th key={String(column)} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="tree-table__sort" onClick={() => onSortChange?.(column)}>
          {label}
          {active && (
            <span aria-hidden="true" className="tree-table__sort-mark">
              {sort.direction === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </button>
      </th>
    )
  }

  /** 見出し。本物の表と、ページのスクロールで固定する複製(StickyHeaderTable)で同じものを使う(計画Issue #266) */
  const head = (
    <thead>
      <tr>
        <th className="tree-table__check-head">
          <input
            type="checkbox"
            aria-label="すべて選択"
            checked={allChecked}
            ref={(element) => {
              if (element) element.indeterminate = checkedVisibleCount > 0 && !allChecked
            }}
            onChange={toggleAll}
          />
        </th>
        {renderHeader('name', nameColumn)}
        {columns.map((column, index) => renderHeader(index, column))}
      </tr>
    </thead>
  )

  return (
    <StickyHeaderTable frameClassName="tree-table" tableClassName="tree-table__table" head={head}>
      <tbody>
        {rows.map((row) => {
          if (row.type === 'category') {
            if (!showCategoryRows) return null
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
              draggable={draggable}
              className={`tree-table__row${isSelected ? ' tree-table__row--selected' : ''}${dimmedIds?.includes(node.id) ? ' tree-table__row--dragging' : ''}`}
              aria-current={isSelected ? 'true' : undefined}
              // チェックが1件でもあるとき(と Ctrl/Cmd を押したとき)は、行のどこを押しても、右パネルを開かずチェックの操作にする。
              // 行の操作である開閉ボタンと、名称の左に差し込まれた操作(お気に入りの★など)は除く(計画Issue #235 D)
              {...range.selectingRowProps(node.id, { ignore: '.tree-table__toggle, .tree-table__leading' })}
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
                  {...range.checkboxProps(node.id)}
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
                  {!isGroup && renderLeafLeading !== undefined && (
                    <span className="tree-table__leading">{renderLeafLeading(node)}</span>
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
    </StickyHeaderTable>
  )
}
