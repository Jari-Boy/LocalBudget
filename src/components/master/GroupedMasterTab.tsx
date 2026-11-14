import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { computeTreeNodeUpdates, type TreeNodeUpdate } from '../common/tree-table/computeTreeNodeUpdates'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import { TreeTable } from '../common/tree-table/TreeTable'
import { BulkSelectionPanel } from './BulkSelectionPanel'
import { CATEGORY_ID_PREFIX, resolveTreeMove, type TreeTableNode } from '../common/tree-table/treeTableModel'
import { groupNodeId, leafNodeId, parseNodeId, type MasterTreeData } from './masterTreeNodes'
import './master.css'

/** 取引先・プロジェクトのように、区分が1つでグループ(入れ子可)と項目を持つマスタの操作 */
export interface GroupedMasterActions {
  /** 移動の差分を1件適用する(親グループと並び順) */
  applyUpdate(update: TreeNodeUpdate): Promise<void>
  createGroup(parentGroupId: number | null): Promise<number>
  createLeaf(parentGroupId: number | null): Promise<number>
  rename(nodeId: string, name: string): Promise<void>
  setLeafActive(leafId: number, active: boolean): Promise<void>
  remove(nodeId: string): Promise<void>
}

export interface GroupedMasterTabProps {
  tree: MasterTreeData
  columns: readonly string[]
  /** 項目の呼び名(例: 「プロジェクト」「取引先」) */
  leafLabel: string
  actions: GroupedMasterActions
  /** 項目が有効か */
  isLeafActive: (leafId: number) => boolean
  /** 項目を削除できない理由(削除できるなら空文字) */
  leafBlockedText: (leafId: number) => string
  /** 変更後に呼び出し元のデータを読み直す */
  onChanged: () => Promise<void>
  /** 選んだ項目の右パネルに足す固有の欄(例: 取引先の既定の科目・パターン) */
  renderLeafExtra?: (leafId: number, context: { reload: () => Promise<void>; busy: boolean }) => ReactNode
  /** 画面に出す直前の操作結果の通知(例: 統合しました)。空なら出さない */
  notice?: string
  /** 2件以上チェックしたときの一括操作パネルに足す、項目への固有の操作(例: 取引先の統合) */
  renderSelection?: (checkedLeafIds: number[], context: { reload: () => Promise<void> }) => ReactNode
}

/**
 * 区分が1つのマスタ(取引先・プロジェクト)の共通の画面(計画Issue #154)。グループと項目を
 * ツリー表で表示し、選んだ行を右パネルで編集する。名称の変更、所属グループの変更(区分内の移動のみ、
 * 自分の配下への移動は拒否)、並び順、グループ・項目の新設、有効/無効、2回押しの削除ができる。
 * データの読み書きは呼び出し側(actions)が担い、この部品は表示と操作の流れだけを持つ。
 */
export function GroupedMasterTab({
  tree,
  columns,
  leafLabel,
  actions,
  isLeafActive,
  leafBlockedText,
  onChanged,
  renderLeafExtra,
  notice,
  renderSelection,
}: GroupedMasterTabProps) {
  const { t } = useTranslation('master')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([])
  const [armedId, setArmedId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 未保存の編集があれば、行の選択・新規作成の前に確認を通す(計画Issue #190) */
  const guarded = useGuardedAction()

  // 統合・削除などで消えた行のチェックは捨てる
  const liveCheckedIds = checkedIds.filter((id) => tree.nodes.some((n) => n.id === id))
  const categoryKey = tree.categories[0].key
  const topId = `${CATEGORY_ID_PREFIX}${categoryKey}`
  const selected = selectedId ? tree.nodes.find((n) => n.id === selectedId) : undefined

  /** 操作を実行する。成功したらtrue、失敗してエラー文言を出したらfalse */
  const run = async (action: () => Promise<void>, errorMessage: string, successMessage = ''): Promise<boolean> => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await action()
      await onChanged()
      setFlash(successMessage)
      return true
    } catch {
      setError(errorMessage)
      return false
    } finally {
      setBusy(false)
    }
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    setArmedId(null)
    setFlash('')
    setError('')
  }

  const applyMove = (next: TreeTableNode[]) =>
    run(async () => {
      for (const update of computeTreeNodeUpdates(tree.nodes, next, tree.sortOrders)) {
        await actions.applyUpdate(update)
      }
    }, t('accountTab.moveError'))

  const moveInto = (id: string, targetId: string) => {
    const result = resolveTreeMove(tree.nodes, [id], { id: targetId, zone: 'inside' })
    if (!result.ok) {
      setError(result.reason)
      return
    }
    void applyMove(result.nodes)
  }

  const shift = (node: TreeTableNode, delta: -1 | 1) => {
    const siblings = tree.nodes.filter((n) => n.parentId === node.parentId)
    const other = siblings[siblings.indexOf(node) + delta]
    if (!other) return
    void applyMove(tree.nodes.map((n) => (n === node ? other : n === other ? node : n)))
  }

  const create = (kind: 'group' | 'leaf', parentGroupId: number | null) =>
    run(async () => {
      const id = kind === 'group' ? await actions.createGroup(parentGroupId) : await actions.createLeaf(parentGroupId)
      select(kind === 'group' ? groupNodeId(id) : leafNodeId(id))
    }, t('accountTab.createError'))

  return (
    <div className="master-split">
      <div className="master-split__main">
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void create('group', null))}>
            {t('groupedTab.addGroup')}
          </button>
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void create('leaf', null))}>
            {t('groupedTab.addLeaf', { leaf: leafLabel })}
          </button>
        </div>
        <TreeTable
          categories={tree.categories}
          nodes={tree.nodes}
          columns={columns}
          checkedIds={liveCheckedIds}
          selectedId={selectedId}
          onSelect={(id) => guarded(() => select(id))}
          // 2件以上のチェックは右パネルを一括操作パネルに差し替えるため、未保存の編集があれば確認を通す
          onCheckedChange={(ids) => (ids.length >= 2 ? guarded(() => setCheckedIds(ids)) : setCheckedIds(ids))}
          onMove={(next) => {
            setCheckedIds([])
            void applyMove(next)
          }}
          onMoveRejected={setError}
        />
        <p className="master-note">{t('accountTab.dragHint')}</p>
        {notice !== undefined && notice !== '' && (
          <p role="status" className="master-flash">
            {notice}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="master-error master-split__alert">
          {error}
        </p>
      )}

      {liveCheckedIds.length >= 2 && (
        <BulkSelectionPanel
          nodes={tree.nodes}
          categories={tree.categories}
          checkedIds={liveCheckedIds}
          busy={busy}
          onMove={(next) => {
            setCheckedIds([])
            void applyMove(next)
          }}
          onMoveRejected={setError}
          onClear={() => setCheckedIds([])}
        >
          {renderSelection?.(
            liveCheckedIds.filter((id) => parseNodeId(id).kind === 'leaf').map((id) => parseNodeId(id).id),
            { reload: onChanged },
          )}
        </BulkSelectionPanel>
      )}

      {liveCheckedIds.length < 2 && selected && (
        <NodePanel
          key={selected.id}
          node={selected}
          nodes={tree.nodes}
          topId={topId}
          leafLabel={leafLabel}
          busy={busy}
          flash={flash}
          armed={armedId === selected.id}
          isActive={selected.kind === 'leaf' ? isLeafActive(parseNodeId(selected.id).id) : true}
          blockedText={
            selected.kind === 'group'
              ? tree.nodes.some((n) => n.parentId === selected.id)
                ? t('accountTab.groupNotEmpty')
                : ''
              : leafBlockedText(parseNodeId(selected.id).id)
          }
          extra={
            selected.kind === 'leaf'
              ? renderLeafExtra?.(parseNodeId(selected.id).id, { reload: onChanged, busy })
              : undefined
          }
          onMoveInto={(targetId) => moveInto(selected.id, targetId)}
          onShift={(delta) => shift(selected, delta)}
          onSave={(name) =>
            run(() => actions.rename(selected.id, name), t('accountTab.saveError'), t('accountTab.saved'))
          }
          onToggleActive={() =>
            run(
              () => actions.setLeafActive(parseNodeId(selected.id).id, !isLeafActive(parseNodeId(selected.id).id)),
              t('accountTab.toggleError'),
            )
          }
          onAddSubgroup={() => void create('group', parseNodeId(selected.id).id)}
          onAddLeaf={() => void create('leaf', parseNodeId(selected.id).id)}
          onDelete={() => {
            if (armedId !== selected.id) {
              setArmedId(selected.id)
              return
            }
            void run(async () => {
              await actions.remove(selected.id)
              setSelectedId(null)
              setArmedId(null)
            }, t('accountTab.deleteError'))
          }}
        />
      )}
    </div>
  )
}

interface NodePanelProps {
  node: TreeTableNode
  nodes: readonly TreeTableNode[]
  topId: string
  leafLabel: string
  busy: boolean
  flash: string
  armed: boolean
  isActive: boolean
  blockedText: string
  extra: ReactNode
  onMoveInto: (targetId: string) => void
  onShift: (delta: -1 | 1) => void
  onSave: (name: string) => Promise<boolean>
  onToggleActive: () => void
  onAddSubgroup: () => void
  onAddLeaf: () => void
  onDelete: () => void
}

/** 配下を含むノードのid */
function withDescendants(nodes: readonly TreeTableNode[], id: string): string[] {
  return [id, ...nodes.filter((n) => n.parentId === id).flatMap((n) => withDescendants(nodes, n.id))]
}

/** 親グループの選択肢(深さに応じて字下げ) */
function groupOptions(nodes: readonly TreeTableNode[], excluded: ReadonlySet<string>) {
  const walk = (parentId: string | null, depth: number): Array<{ value: string; label: string }> =>
    nodes
      .filter((n) => n.parentId === parentId && n.kind === 'group' && !excluded.has(n.id))
      .flatMap((n) => [{ value: n.id, label: `${'　'.repeat(depth)}${n.name}` }, ...walk(n.id, depth + 1)])
  return walk(null, 0)
}

/** 選んだグループ・項目の右パネル。名称は下書きを持ち、「保存」で確定する */
function NodePanel(props: NodePanelProps) {
  const { node, nodes, busy } = props
  const { t } = useTranslation('master')
  const isGroup = node.kind === 'group'
  const [name, setName] = useState(node.name)
  // 名称が保存済みの値と違う間は、画面を離れる前に確認する(計画Issue #190)
  const unsavedDialog = useUnsavedEditGuard({
    dirty: name.trim() !== node.name,
    save: () => (name.trim() === '' ? Promise.resolve(false) : props.onSave(name.trim())),
  })
  const siblings = nodes.filter((n) => n.parentId === node.parentId)
  const index = siblings.findIndex((n) => n.id === node.id)
  const options = groupOptions(nodes, new Set(isGroup ? withDescendants(nodes, node.id) : []))
  const title = isGroup ? t('groupedTab.editGroup') : t('groupedTab.editLeaf', { leaf: props.leafLabel })

  return (
    <section className="master-panel" aria-label={title}>
      <h2 className="master-panel__title">{title}</h2>

      <div className="master-field">
        <label className="master-field__label" htmlFor="master-edit-name">
          {t('accountTab.name')}
        </label>
        <input
          id="master-edit-name"
          className="master-field__control"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="master-field">
        <label className="master-field__label" htmlFor="master-edit-parent">
          {t(isGroup ? 'accountTab.parentGroup' : 'accountTab.group')}
        </label>
        <select
          id="master-edit-parent"
          className="master-field__control"
          value={node.parentId ?? props.topId}
          disabled={busy}
          onChange={(event) => props.onMoveInto(event.target.value)}
        >
          <option value={props.topId}>{t(isGroup ? 'accountTab.top' : 'accountTab.groupNone')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="master-actions">
        <span className="master-field__label">{t('accountTab.order')}</span>
        <button type="button" className="master-btn" disabled={busy || index <= 0} onClick={() => props.onShift(-1)}>
          {t('accountTab.up')}
        </button>
        <button
          type="button"
          className="master-btn"
          disabled={busy || index >= siblings.length - 1}
          onClick={() => props.onShift(1)}
        >
          {t('accountTab.down')}
        </button>
      </div>

      {props.extra}

      {isGroup && (
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={busy} onClick={props.onAddSubgroup}>
            {t('accountTab.addSubgroup')}
          </button>
          <button type="button" className="master-btn" disabled={busy} onClick={props.onAddLeaf}>
            {`+ ${props.leafLabel}`}
          </button>
        </div>
      )}

      <div className="master-actions">
        <button
          type="button"
          className="master-btn master-btn--primary"
          disabled={busy || name.trim() === ''}
          onClick={() => props.onSave(name.trim())}
        >
          {t('accountTab.save')}
        </button>
        <button
          type="button"
          className={`master-btn${props.armed ? ' master-btn--danger' : ''}`}
          disabled={busy || props.blockedText !== ''}
          onClick={props.onDelete}
        >
          {props.armed ? t('accountTab.deleteConfirm') : t(isGroup ? 'accountTab.deleteGroup' : 'accountTab.delete')}
        </button>
        {!isGroup && (
          <button type="button" className="master-btn" disabled={busy} onClick={props.onToggleActive}>
            {t(props.isActive ? 'accountTab.deactivate' : 'accountTab.activate')}
          </button>
        )}
        <span role="status" className="master-flash">
          {props.flash}
        </span>
      </div>

      {props.blockedText !== '' && <p className="master-note">{props.blockedText}</p>}
      {unsavedDialog}
    </section>
  )
}
