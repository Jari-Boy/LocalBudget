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
  onClose: () => void
  isAdding: boolean
  addError: string | null
}

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

/**
 * 関連仕訳ダイアログ(計画Issue #138、UIレビューにより仕訳詳細画面への常時インライン表示から
 * 「関連仕訳」ボタン押下で開くダイアログ方式へ変更)。関連仕訳グループは多対多であり、1つの仕訳が
 * 複数の無関係なグループに同時に所属できる(例: SettlementScreenが複数の割勘バッチを1件の
 * 精算仕訳で橋渡しする場合)。これを1本のフラットな一覧に合算して表示すると、どのグループが
 * どの関係かが分からなくなる(UIレビューでの指摘)ため、groupRelatedEntriesByLinkGroupの結果
 * (グループ単位の塊)をそのまま枠で区切って表示する。各グループの表示名はクリックした場で編集
 * できる(EditableGroupName)。関連付け候補が存在する場合のみ「+ 関連仕訳を追加」行を表示し、
 * 押すとセレクトが現れ、候補を選んだ瞬間にonAddEntryを呼ぶ(CounterpartyQuickAddSelectと同じ
 * 「選択=即確定」方式、確定・キャンセルボタンは置かない)。将来的に仕訳数が増えた場合、
 * このセレクトは専用の仕訳検索画面に置き換える想定(現時点では対応しない)。
 */
export function RelatedEntriesDialog({
  relatedEntryGroups,
  relateCandidates,
  onSelectEntry,
  onAddEntry,
  onRenameGroup,
  onClose,
  isAdding,
  addError,
}: RelatedEntriesDialogProps) {
  const { t } = useTranslation('journal')
  const [isAddFormOpen, setIsAddFormOpen] = useState(false)
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
            {relatedEntryGroups.map((group, index) => (
              <div key={group.groupId} className="related-group">
                <div className="related-group-header">
                  <EditableGroupName
                    defaultName={t('relatedEntryGroupDefaultName', { index: index + 1 })}
                    name={group.name}
                    onRename={(name) => onRenameGroup(group.groupId, name)}
                  />
                </div>
                <ul className="related-entries-list">
                  {group.entries.map((relatedEntry) => (
                    <li key={relatedEntry.id}>
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
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
