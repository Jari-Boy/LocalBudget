import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { RelatedEntryGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './RelatedEntriesDialog.css'

export interface RelatedEntriesDialogProps {
  relatedEntryGroups: RelatedEntryGroup[]
  relateCandidates: JournalEntry[]
  onSelectEntry: (entry: JournalEntry) => void
  onAddEntry: (entryId: number) => void | Promise<void>
  onRenameGroup: (groupId: number, name: string | null) => void | Promise<void>
  onRemoveEntry: (groupId: number, entryId: number) => void | Promise<void>
  onMoveEntry: (sourceGroupId: number, targetGroupId: number | null, entryId: number) => void | Promise<void>
  onClose: () => void
  isAdding: boolean
  addError: string | null
}

/** 移動先セレクトの「+ 新しいグループを作る」を表す特殊値(CounterpartyQuickAddSelectの
 * NEW_COUNTERPARTY_OPTION_VALUEと同じパターン)。グループidと衝突しない文字列を使う */
const NEW_GROUP_OPTION_VALUE = '__new_group__'
/** ドラッグ中のドロップ先ハイライト状態(dragOverTarget)で「+ 新しいグループを作る」ゾーンを
 * 表す特殊値。グループidは常に正の整数のため負の値にして衝突を避ける */
const NEW_GROUP_DROP_ZONE_ID = -1

/** 借方/貸方という簿記用語を見せず、単一の取引金額として表示する(JournalEntryListScreenと同じ計算方法) */
function calculateEntryTotal(entry: JournalEntry): number {
  return entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

interface EditableGroupNameProps {
  defaultName: string
  name: string | null
  onRename: (name: string | null) => void
}

/**
 * グループ名の表示/編集を切り替えるラベル(計画Issue #138、UIレビュー指摘)。クリックすると
 * その場でテキスト入力に変わり、Enterまたはフォーカス外しで確定、Escapeで編集前の表示に戻す。
 * 確定・キャンセルボタンは置かない(CounterpartyQuickAddSelectと同じ「明示的な操作ボタンに
 * 頼らない」方針)。表示名が未設定(name === null)の場合はdefaultName(「グループN」)を表示するが、
 * この既定名自体は保存しない(空入力で確定した場合はnullを渡す)。
 */
function EditableGroupName({ defaultName, name, onRename }: EditableGroupNameProps) {
  const { t } = useTranslation('journal')
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const displayName = name ?? defaultName

  if (isEditing) {
    return (
      <input
        className="related-group-name-input"
        aria-label={t('editGroupNameLabel')}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setIsEditing(false)
          onRename(draft.trim() === '' ? null : draft.trim())
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            setIsEditing(false)
            onRename(draft.trim() === '' ? null : draft.trim())
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setIsEditing(false)
          }
        }}
      />
    )
  }

  return (
    <span
      className="related-group-name"
      role="button"
      tabIndex={0}
      aria-label={t('editGroupNameLabel')}
      onClick={() => {
        setDraft(name ?? '')
        setIsEditing(true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setDraft(name ?? '')
          setIsEditing(true)
        }
      }}
    >
      {displayName}
      <span className="related-group-name-pencil" aria-hidden="true">
        ✎
      </span>
    </span>
  )
}

interface PendingMove {
  sourceGroupId: number
  targetGroupId: number | null
  entryId: number
}

/**
 * 関連仕訳ダイアログ(計画Issue #138、UIレビューにより仕訳詳細画面への常時インライン表示から
 * 「関連仕訳」ボタン押下で開くダイアログ方式へ変更)。関連仕訳グループは多対多であり、1つの仕訳が
 * 複数の無関係なグループに同時に所属できる(例: SettlementScreenが複数の割勘バッチを1件の
 * 精算仕訳で橋渡しする場合)。これを1本のフラットな一覧に合算して表示すると、どのグループが
 * どの関係かが分からなくなる(UIレビューでの指摘)ため、groupRelatedEntriesByLinkGroupの結果
 * (グループ単位の塊)をそのまま枠で区切って表示する。各グループの表示名はクリックした場で編集
 * できる(EditableGroupName)。各行には関連付けを解除する「×」ボタンを併置する(行自体の
 * クリックボタンとは別のボタンとして並べ、ボタン内ボタンというHTML上不正な入れ子を避ける)。
 *
 * 行をグループ間でドラッグ&ドロップして移動できる(AccountGroupManagementScreenと同じ
 * HTML5 Drag and Drop APIのパターン)。タッチ操作でドラッグが使えない場合に備え、各行に
 * 移動先を選ぶセレクト(⇄ボタン押下で表示)も用意する(AccountGroupManagementScreenの
 * 「ドラッグ&ドロップ/チェックボックス選択+移動セレクト」の二択と同じ考え方)。移動先には
 * 既存グループに加え「+ 新しいグループを作る」を選べる。移動の結果、移動元グループの残りが
 * 0件(表示上は自分以外のメンバーが0件、つまり移動対象が最後の1件)になる場合、グループが
 * 一覧から見えなくなることを警告し、確定操作を経てから実行する(ユーザー要望への対応)。
 *
 * 関連付け候補が存在する場合のみ「+ 関連仕訳を追加」行を表示し、押すとセレクトが現れ、
 * 候補を選んだ瞬間にonAddEntryを呼ぶ(CounterpartyQuickAddSelectと同じ「選択=即確定」方式、
 * 確定・キャンセルボタンは置かない)。将来的に仕訳数が増えた場合、このセレクトは専用の
 * 仕訳検索画面に置き換える想定(現時点では対応しない)。
 */
export function RelatedEntriesDialog({
  relatedEntryGroups,
  relateCandidates,
  onSelectEntry,
  onAddEntry,
  onRenameGroup,
  onRemoveEntry,
  onMoveEntry,
  onClose,
  isAdding,
  addError,
}: RelatedEntriesDialogProps) {
  const { t } = useTranslation('journal')
  const [isAddFormOpen, setIsAddFormOpen] = useState(false)
  const [draggingEntryId, setDraggingEntryId] = useState<number | null>(null)
  const [dragOverTargetId, setDragOverTargetId] = useState<number | null>(null)
  const [movingRow, setMovingRow] = useState<{ groupId: number; entryId: number } | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const groupIndexById = new Map(relatedEntryGroups.map((group, index) => [group.groupId, index]))
  function groupLabel(group: RelatedEntryGroup): string {
    return group.name ?? t('relatedEntryGroupDefaultName', { index: (groupIndexById.get(group.groupId) ?? 0) + 1 })
  }
  function findSourceGroupId(entryId: number): number | undefined {
    return relatedEntryGroups.find((group) => group.entries.some((entry) => entry.id === entryId))?.groupId
  }

  function attemptMove(sourceGroupId: number, targetGroupId: number | null, entryId: number): void {
    if (sourceGroupId === targetGroupId) return
    const sourceGroup = relatedEntryGroups.find((group) => group.groupId === sourceGroupId)
    if (sourceGroup !== undefined && sourceGroup.entries.length === 1) {
      setPendingMove({ sourceGroupId, targetGroupId, entryId })
      return
    }
    void onMoveEntry(sourceGroupId, targetGroupId, entryId)
  }

  return (
    <div
      className="related-entries-dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={t('relatedEntriesTitle')} className="related-entries-dialog">
        <div className="related-entries-dialog-header">
          <h3>{t('relatedEntriesTitle')}</h3>
          <button ref={closeButtonRef} type="button" className="related-entries-dialog-close" onClick={onClose}>
            {t('closeDialog')}
          </button>
        </div>

        {relatedEntryGroups.length === 0 ? (
          <p>{t('relatedEntriesEmpty')}</p>
        ) : (
          <div className="related-groups">
            {relatedEntryGroups.map((group) => (
              <div
                key={group.groupId}
                className={
                  'related-group' + (dragOverTargetId === group.groupId ? ' related-group-drop-target' : '')
                }
                onDragOver={(event) => {
                  if (draggingEntryId === null) return
                  event.preventDefault()
                  setDragOverTargetId(group.groupId)
                }}
                onDragLeave={() => setDragOverTargetId((prev) => (prev === group.groupId ? null : prev))}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOverTargetId(null)
                  if (draggingEntryId === null) return
                  const sourceGroupId = findSourceGroupId(draggingEntryId)
                  if (sourceGroupId === undefined) return
                  attemptMove(sourceGroupId, group.groupId, draggingEntryId)
                }}
              >
                <div className="related-group-header">
                  <EditableGroupName
                    defaultName={groupLabel(group)}
                    name={group.name}
                    onRename={(name) => onRenameGroup(group.groupId, name)}
                  />
                </div>

                {pendingMove !== null && pendingMove.sourceGroupId === group.groupId && (
                  <div className="related-group-empty-warning" role="alert">
                    <p>{t('emptyGroupMoveWarning', { name: groupLabel(group) })}</p>
                    <div className="related-group-empty-warning-actions">
                      <button type="button" onClick={() => setPendingMove(null)}>
                        {t('cancelButton')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onMoveEntry(pendingMove.sourceGroupId, pendingMove.targetGroupId, pendingMove.entryId)
                          setPendingMove(null)
                        }}
                      >
                        {t('confirmMoveButton')}
                      </button>
                    </div>
                  </div>
                )}

                <ul className="related-entries-list">
                  {group.entries.map((relatedEntry) => (
                    <li
                      key={relatedEntry.id}
                      className={
                        'related-entries-list-item' + (draggingEntryId === relatedEntry.id ? ' dragging' : '')
                      }
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', String(relatedEntry.id))
                        event.dataTransfer.effectAllowed = 'move'
                        setDraggingEntryId(relatedEntry.id)
                      }}
                      onDragEnd={() => {
                        setDraggingEntryId(null)
                        setDragOverTargetId(null)
                      }}
                    >
                      <span className="related-entries-list-grip" aria-hidden="true">
                        ⠿
                      </span>
                      <button
                        type="button"
                        className="related-entries-list-row"
                        onClick={() => onSelectEntry(relatedEntry)}
                      >
                        <span className="related-entries-list-date">{relatedEntry.entryDate}</span>
                        <span className="related-entries-list-memo">{relatedEntry.memo ?? t('entryNoMemo')}</span>
                        <span className="related-entries-list-amount">
                          {formatCurrency(calculateEntryTotal(relatedEntry), 'JPY')}
                        </span>
                      </button>
                      {movingRow !== null && movingRow.groupId === group.groupId && movingRow.entryId === relatedEntry.id ? (
                        <select
                          autoFocus
                          aria-label={t('moveEntryLabel')}
                          defaultValue=""
                          onBlur={() => setMovingRow(null)}
                          onChange={(event) => {
                            setMovingRow(null)
                            if (event.target.value === '') return
                            const targetGroupId =
                              event.target.value === NEW_GROUP_OPTION_VALUE ? null : Number(event.target.value)
                            attemptMove(group.groupId, targetGroupId, relatedEntry.id)
                          }}
                        >
                          <option value="">{t('unselected')}</option>
                          {relatedEntryGroups
                            .filter((candidate) => candidate.groupId !== group.groupId)
                            .map((candidate) => (
                              <option key={candidate.groupId} value={candidate.groupId}>
                                {groupLabel(candidate)}
                              </option>
                            ))}
                          <option value={NEW_GROUP_OPTION_VALUE}>{t('newGroupOption')}</option>
                        </select>
                      ) : (
                        <button
                          type="button"
                          className="related-entries-list-move"
                          aria-label={t('moveEntryLabel')}
                          onClick={() => setMovingRow({ groupId: group.groupId, entryId: relatedEntry.id })}
                        >
                          ⇄
                        </button>
                      )}
                      <button
                        type="button"
                        className="related-entries-list-remove"
                        aria-label={t('removeRelatedEntryLabel')}
                        onClick={() => onRemoveEntry(group.groupId, relatedEntry.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div
              className={
                'new-group-dropzone' + (dragOverTargetId === NEW_GROUP_DROP_ZONE_ID ? ' drop-target' : '')
              }
              onDragOver={(event) => {
                if (draggingEntryId === null) return
                event.preventDefault()
                setDragOverTargetId(NEW_GROUP_DROP_ZONE_ID)
              }}
              onDragLeave={() => setDragOverTargetId((prev) => (prev === NEW_GROUP_DROP_ZONE_ID ? null : prev))}
              onDrop={(event) => {
                event.preventDefault()
                setDragOverTargetId(null)
                if (draggingEntryId === null) return
                const sourceGroupId = findSourceGroupId(draggingEntryId)
                if (sourceGroupId === undefined) return
                attemptMove(sourceGroupId, null, draggingEntryId)
              }}
            >
              {t('newGroupOption')}
            </div>
          </div>
        )}

        {relateCandidates.length > 0 &&
          (isAddFormOpen ? (
            <select
              autoFocus
              aria-label={t('relateEntryLabel')}
              defaultValue=""
              disabled={isAdding}
              onBlur={() => setIsAddFormOpen(false)}
              onChange={(event) => {
                if (event.target.value === '') return
                setIsAddFormOpen(false)
                void onAddEntry(Number(event.target.value))
              }}
            >
              <option value="">{t('unselected')}</option>
              {relateCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.entryDate} {candidate.memo ?? t('entryNoMemo')}
                </option>
              ))}
            </select>
          ) : (
            <button type="button" className="related-entries-add-button" onClick={() => setIsAddFormOpen(true)}>
              {t('addRelatedEntryButton')}
            </button>
          ))}
        {addError !== null && <p role="alert">{addError}</p>}
      </div>
    </div>
  )
}
