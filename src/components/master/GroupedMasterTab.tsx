import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FavoriteStarButton } from '../common/favorites/FavoriteStarButton'
import type { FavoriteKind } from '../common/favorites/FavoritesContext'
import { computeTreeNodeUpdates, type TreeNodeUpdate } from '../common/tree-table/computeTreeNodeUpdates'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import { TreeCardList, type TreeCardContent } from '../common/tree-table/TreeCardList'
import { TreeTable } from '../common/tree-table/TreeTable'
import { TreeSearchInput } from '../common/tree-table/TreeSearchInput'
import { filterTreeNodes } from '../common/tree-table/filterTreeNodes'
import { BulkSelectionPanel } from './BulkSelectionPanel'
import { CATEGORY_ID_PREFIX, resolveTreeMove, topLevelIds, type TreeTableNode } from '../common/tree-table/treeTableModel'
import { GroupNodeSelect } from './GroupNodeSelect'
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

/**
 * 選んだ項目の右パネルに足す固有のフォーム(renderLeafExtra)が、親の「保存」「未保存の警告」と
 * 連動するための状態(計画Issue #201。仕訳テンプレートの摘要・起票者・明細行)。固有のフォームは
 * 内容が変わるたびにsetFormStateで渡し、右パネルの「保存」は名称と一緒にsaveを呼ぶ。
 * validがfalseの間はreasonを注記として出し、変更(dirty)があるときは「保存」が押せない(変更が無ければ、名称だけ
 * 保存できる)。保存が失敗したらsaveは例外を投げる
 */
export interface LeafFormState {
  dirty: boolean
  valid: boolean
  /** validがfalseのとき、押せない理由 */
  reason?: string
  save: () => Promise<void>
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
  /** 渡すと、項目の行の名称の左に、お気に入りの★を出す(計画Issue #231 フェーズ4)。項目のidを、この種類のidとして扱う */
  favoriteKind?: FavoriteKind
  /** 選んだ項目の右パネルに足す固有の欄(例: 取引先の既定の科目・パターン) */
  /**
   * 渡すと、左の一覧を表(TreeTable)ではなく、仕訳一覧と同じ見た目のカード型(TreeCardList)で出す
   * (計画Issue #201。仕訳テンプレート)。カード型は複数選択(チェック)を持たない
   */
  renderCard?: (node: TreeTableNode) => TreeCardContent
  /** 外枠(master-split)に足すクラス。例: master-split--ruleで、右パネルを広く取る(仕訳の詳細と同じ幅の比) */
  splitClassName?: string
  renderLeafExtra?: (
    leafId: number,
    context: {
      reload: () => Promise<void>
      busy: boolean
      /** 固有のフォームが「保存」「未保存の警告」と連動したいときに状態を渡す。連動しない画面は使わない */
      setFormState: (state: LeafFormState | null) => void
    },
  ) => ReactNode
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
  favoriteKind,
  leafBlockedText,
  onChanged,
  renderLeafExtra,
  renderCard,
  splitClassName,
  notice,
  renderSelection,
}: GroupedMasterTabProps) {
  const { t } = useTranslation('master')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([])
  /** 検索欄の文字列(計画Issue #219)。空でなければ一覧を絞り込み、その間はドラッグを無効にする */
  const [query, setQuery] = useState('')
  const [armedId, setArmedId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 未保存の編集があれば、行の選択・新規作成の前に確認を通す(計画Issue #190) */
  const guarded = useGuardedAction()

  // 統合・削除などで消えた行のチェックは捨てる
  const liveCheckedIds = checkedIds.filter((id) => tree.nodes.some((n) => n.id === id))
  // 右パネルを一括操作パネルに切り替える条件は、チェックした「一番上の行」(グループと配下を同時にチェックしたときはグループ1件)が2件以上
  // (グループのチェックは配下に連動するため、行の数ではなく一番上の行の数で数える。計画Issue #235 E)
  const bulkCount = topLevelIds(tree.nodes, liveCheckedIds).length
  const searching = query.trim() !== ''
  const shownNodes = filterTreeNodes(tree.nodes, query)
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
    <div className={`master-split${splitClassName === undefined ? '' : ` ${splitClassName}`}`}>
      <div className="master-split__main">
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void create('group', null))}>
            {t('groupedTab.addGroup')}
          </button>
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void create('leaf', null))}>
            {t('groupedTab.addLeaf', { leaf: leafLabel })}
          </button>
          {renderCard === undefined && (
            <TreeSearchInput
              value={query}
              onChange={(next) => {
                setQuery(next)
                // 絞り込みで隠れた行が一括操作の対象に残らないよう、チェックを外す
                setCheckedIds([])
              }}
              leafLabel={leafLabel}
            />
          )}
        </div>
        {renderCard !== undefined ? (
          <TreeCardList
            categories={tree.categories}
            nodes={tree.nodes}
            selectedId={selectedId}
            onSelect={(id) => guarded(() => select(id))}
            onMove={(next) => void applyMove(next)}
            onMoveRejected={setError}
            renderCard={renderCard}
          />
        ) : (
          <TreeTable
            categories={tree.categories}
            nodes={shownNodes}
            // 検索で絞り込んでいても、グループのチェックは絞り込み前の全ノードで配下に連動させる(計画Issue #235 E)
            cascadeNodes={tree.nodes}
            columns={columns}
            draggable={!searching}
            checkedIds={liveCheckedIds}
            selectedId={selectedId}
            onSelect={(id) => guarded(() => select(id))}
            // 2件以上のチェックは右パネルを一括操作パネルに差し替えるため、未保存の編集があれば確認を通す
            onCheckedChange={(ids) => (topLevelIds(tree.nodes, ids).length >= 2 ? guarded(() => setCheckedIds(ids)) : setCheckedIds(ids))}
            onMove={(next) => {
              setCheckedIds([])
              void applyMove(next)
            }}
            onMoveRejected={setError}
            renderLeafLeading={
              favoriteKind === undefined
                ? undefined
                : (node) => <FavoriteStarButton kind={favoriteKind} id={parseNodeId(node.id).id} name={node.name} />
            }
          />
        )}
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

      {bulkCount >= 2 && (
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

      {bulkCount < 2 && selected && (
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
          renderExtra={
            selected.kind === 'leaf' && renderLeafExtra !== undefined
              ? ({ setFormState }) =>
                  renderLeafExtra(parseNodeId(selected.id).id, { reload: onChanged, busy, setFormState })
              : undefined
          }
          onSaveExtra={(save) => run(save, t('accountTab.saveError'), t('accountTab.saved'))}
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
  /** 項目の固有のフォーム。状態を渡すsetFormStateを受け取る */
  renderExtra?: (context: { setFormState: (state: LeafFormState | null) => void }) => ReactNode
  /** 固有のフォームの保存を、他の操作と同じ流れ(実行中の表示・失敗の通知・データの読み直し)で実行する */
  onSaveExtra: (save: () => Promise<void>) => Promise<boolean>
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

/** 選んだグループ・項目の右パネル。名称は下書きを持ち、「保存」で確定する */
function NodePanel(props: NodePanelProps) {
  const { node, nodes, busy } = props
  const { t } = useTranslation('master')
  const isGroup = node.kind === 'group'
  const [name, setName] = useState(node.name)
  /** 固有のフォームの状態(計画Issue #201)。無ければ名称だけが保存の対象 */
  const [extraForm, setExtraForm] = useState<LeafFormState | null>(null)
  const nameDirty = name.trim() !== node.name
  /** 固有のフォームが不正か(理由の表示用) */
  const extraInvalid = extraForm !== null && !extraForm.valid
  /** 保存を止めるのは、固有のフォームが変更されていて、かつ不正なときだけ(未変更なら名称だけ保存できる) */
  const extraBlocking = extraInvalid && (extraForm?.dirty ?? false)

  /** 名称が変わっていれば名称を、固有のフォームが変わっていればその内容を保存する。途中で失敗したらfalse */
  const saveAll = async (): Promise<boolean> => {
    if (name.trim() === '' || extraBlocking) return false
    if (nameDirty && !(await props.onSave(name.trim()))) return false
    if (extraForm?.dirty && !(await props.onSaveExtra(extraForm.save))) return false
    return true
  }

  // 名称・固有のフォームが保存済みの値と違う間は、画面を離れる前に確認する(計画Issue #190)
  const unsavedDialog = useUnsavedEditGuard({
    dirty: nameDirty || (extraForm?.dirty ?? false),
    save: saveAll,
  })
  const siblings = nodes.filter((n) => n.parentId === node.parentId)
  const index = siblings.findIndex((n) => n.id === node.id)
  const excludedIds = isGroup ? withDescendants(nodes, node.id) : []
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
        <span className="master-field__label">{t(isGroup ? 'accountTab.parentGroup' : 'accountTab.group')}</span>
        <GroupNodeSelect
          label={t(isGroup ? 'accountTab.parentGroup' : 'accountTab.group')}
          nodes={nodes}
          excludedIds={excludedIds}
          topId={props.topId}
          topLabel={t(isGroup ? 'accountTab.top' : 'accountTab.groupNone')}
          value={node.parentId ?? props.topId}
          disabled={busy}
          onChange={props.onMoveInto}
        />
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

      {props.renderExtra?.({ setFormState: setExtraForm })}

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
          disabled={busy || name.trim() === '' || extraBlocking}
          onClick={() => void saveAll()}
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

      {extraInvalid && extraForm?.reason !== undefined && <p className="master-note">{extraForm.reason}</p>}
      {props.blockedText !== '' && <p className="master-note">{props.blockedText}</p>}
      {unsavedDialog}
    </section>
  )
}
