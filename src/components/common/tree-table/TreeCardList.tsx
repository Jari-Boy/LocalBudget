import { useState } from 'react'
import { CATEGORY_ID_PREFIX, buildTreeTableRows, type TreeTableCategory, type TreeTableNode } from './treeTableModel'
import { useTreeDrag, type TreeMoveInfo } from './useTreeDrag'
import '../journal-result/JournalResultList.css'
import './TreeCardList.css'

/** 葉のカードに出す内容。タグ(無効など)・右の金額・下の補足 */
export interface TreeCardContent {
  /** カードの下の1行(例: 内容) */
  sub?: string
  /** カードの右に出す値(例: 金額) */
  amount?: string
  /** 名称の左に出す小さなタグ(例: 無効) */
  tag?: string
}

export interface TreeCardListProps {
  categories: readonly TreeTableCategory[]
  nodes: readonly TreeTableNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** 判定済みの有効な移動だけを、移動後のノード配列とともに通知する */
  onMove: (next: TreeTableNode[], info: TreeMoveInfo) => void
  /** 区分またぎ・自分の配下への移動など、拒否した理由を通知する */
  onMoveRejected?: (reason: string) => void
  /** 葉のカードの内容を決める */
  renderCard: (node: TreeTableNode) => TreeCardContent
}

/**
 * カード型のツリー一覧(計画Issue #201)。仕訳一覧(JournalResultList)と同じ見た目のカード(名称・右に金額・
 * 下に補足・名称の左にタグ)で、区分の見出し・入れ子のグループ(開閉)・選択・ドラッグ移動を持つ。
 * ドラッグ移動はTreeTableと同じ規則(行の上端・下端で並び替え、グループの中央で中へ、区分の見出しで最上位へ。
 * 判定は純粋関数のresolveTreeMove、共通の処理はuseTreeDrag)。複数選択(チェック)は持たない。
 * 表示用の汎用ノード型だけを受け取り、DB・Repositoryには依存しない。
 */
export function TreeCardList({ categories, nodes, selectedId, onSelect, onMove, onMoveRejected, renderCard }: TreeCardListProps) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const { dragOver, endDrag, handleDragStart, handleNodeDragOver, handleCategoryDragOver, handleDrop } = useTreeDrag({
    nodes,
    checkedIds: [],
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

  return (
    <div className="journal-result-list tree-card-list">
      <ul className="journal-result-list__items">
        {rows.map((row) => {
          if (row.type === 'category') {
            const id = `${CATEGORY_ID_PREFIX}${row.key}`
            return (
              <li
                key={id}
                className="tree-card-list__category"
                data-drop-zone={dragOver?.id === id ? dragOver.zone : undefined}
                onDragOver={(event) => handleCategoryDragOver(event, row.key)}
                onDrop={(event) => handleDrop(event, id)}
              >
                <span className="tree-card-list__category-name">{row.name}</span>
                <span className="tree-card-list__count">{row.count}件</span>
              </li>
            )
          }
          const { node, depth, isGroup, isOpen, leafCount } = row
          const isSelected = node.id === selectedId
          const dragProps = {
            draggable: true,
            'data-drop-zone': dragOver?.id === node.id ? dragOver.zone : undefined,
            onDragStart: (event: React.DragEvent<HTMLElement>) => handleDragStart(event, node.id),
            onDragOver: (event: React.DragEvent<HTMLElement>) => handleNodeDragOver(event, node),
            onDrop: (event: React.DragEvent<HTMLElement>) => handleDrop(event, node.id),
            onDragEnd: endDrag,
          }

          if (isGroup) {
            return (
              <li key={node.id} {...dragProps}>
                <div
                  className={`journal-result-list__row tree-card-list__group${isSelected ? ' journal-result-list__row--selected' : ''}`}
                  style={{ paddingLeft: 12 + depth * 18 }}
                >
                  <button
                    type="button"
                    className="tree-card-list__toggle"
                    aria-expanded={isOpen}
                    aria-label={`${node.name}を開閉`}
                    onClick={() => toggleCollapsed(node.id)}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className="tree-card-list__group-name"
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelect(node.id)}
                  >
                    {node.name}
                  </button>
                  <span className="tree-card-list__count">{leafCount}件</span>
                </div>
              </li>
            )
          }

          const card = renderCard(node)
          return (
            <li key={node.id} {...dragProps}>
              <button
                type="button"
                // 補足の行まで含めると名前が長くなるため、名称だけを名前にする
                aria-label={node.name}
                aria-current={isSelected ? 'true' : undefined}
                className={`journal-result-list__row journal-result-list__row--button${isSelected ? ' journal-result-list__row--selected' : ''}`}
                style={{ paddingLeft: 12 + depth * 18 }}
                onClick={() => onSelect(node.id)}
              >
                <span className="journal-result-list__line">
                  <span className="journal-result-list__title">
                    {card.tag !== undefined && (
                      <span
                        className="journal-result-list__tag"
                        style={{ background: 'var(--color-tag-neutral-bg)', color: 'var(--color-tag-neutral-text)' }}
                      >
                        {card.tag}
                      </span>
                    )}
                    <span className="journal-result-list__memo">{node.name}</span>
                  </span>
                  {card.amount !== undefined && <span className="journal-result-list__amount">{card.amount}</span>}
                </span>
                {card.sub !== undefined && <span className="journal-result-list__sub">{card.sub}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
