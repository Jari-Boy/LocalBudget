import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TreeTableMoveInfo } from '../common/tree-table/TreeTable'
import {
  listMoveDestinations,
  resolveTreeMove,
  type TreeTableCategory,
  type TreeTableNode,
} from '../common/tree-table/treeTableModel'
import './master.css'

export interface BulkSelectionPanelProps {
  nodes: readonly TreeTableNode[]
  categories: readonly TreeTableCategory[]
  /** チェックした行(グループ・項目)のid */
  checkedIds: readonly string[]
  busy: boolean
  /** 判定済みの有効な移動だけを、移動後のノード配列とともに通知する */
  onMove: (next: TreeTableNode[], info: TreeTableMoveInfo) => void
  /** 区分またぎ・自分の配下への移動など、拒否した理由を通知する */
  onMoveRejected: (reason: string) => void
  onClear: () => void
  /** 固有の操作(統合など)。「グループへ移動」の下に並ぶ */
  children?: ReactNode
}

/**
 * マスタ画面で2件以上チェックしたときに、編集パネルの代わりに右側へ出す「一括操作」パネル
 * (計画Issue #97)。選択件数と名称、「グループへ移動」(ドラッグが使えなくても同じ判定で移動できる)、
 * 選択の解除、各マスタ固有の操作(統合など)を縦に並べる。
 */
export function BulkSelectionPanel({
  nodes,
  categories,
  checkedIds,
  busy,
  onMove,
  onMoveRejected,
  onClear,
  children,
}: BulkSelectionPanelProps) {
  const { t } = useTranslation('master')
  const destinations = listMoveDestinations(nodes, categories, checkedIds)
  const names = checkedIds.map((id) => nodes.find((n) => n.id === id)?.name ?? '').join('、')

  const moveTo = (targetId: string) => {
    if (targetId === '') return
    const result = resolveTreeMove(nodes, checkedIds, { id: targetId, zone: 'inside' })
    if (!result.ok) {
      onMoveRejected(result.reason)
      return
    }
    onMove(result.nodes, { ids: checkedIds, targetId, zone: 'inside', expandId: result.expandId })
  }

  return (
    <section className="master-panel" aria-label={t('bulk.region')}>
      <h2 className="master-panel__title">{t('bulk.title', { count: checkedIds.length })}</h2>
      <p className="master-note">{names}</p>

      <section className="master-subsection" aria-label={t('bulk.moveTitle')}>
        <h3 className="master-subsection__title">{t('bulk.moveTitle')}</h3>
        {destinations.length === 0 ? (
          <p className="master-note">{t('bulk.moveCrossCategory')}</p>
        ) : (
          <div className="master-field">
            <label className="master-field__label" htmlFor="bulk-move-destination">
              {t('bulk.moveDestination')}
            </label>
            <select
              id="bulk-move-destination"
              className="master-field__control"
              disabled={busy}
              value=""
              onChange={(event) => moveTo(event.target.value)}
            >
              <option value="">{t('bulk.choose')}</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {children}

      <div className="master-actions master-actions--divided">
        <button type="button" className="master-btn" onClick={onClear}>
          {t('bulk.clear')}
        </button>
      </div>
    </section>
  )
}
