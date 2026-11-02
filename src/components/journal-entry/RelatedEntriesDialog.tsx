import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './RelatedEntriesDialog.css'

export interface RelatedEntriesDialogProps {
  relatedEntries: JournalEntry[]
  relateCandidates: JournalEntry[]
  onSelectEntry: (entry: JournalEntry) => void
  onAddEntry: (entryId: number) => void | Promise<void>
  onClose: () => void
  isAdding: boolean
  addError: string | null
}

/** 借方/貸方という簿記用語を見せず、単一の取引金額として表示する(JournalEntryListScreenと同じ計算方法) */
function calculateEntryTotal(entry: JournalEntry): number {
  return entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

/**
 * 関連仕訳ダイアログ(計画Issue #138、UIレビューにより仕訳詳細画面への常時インライン表示から
 * 「関連仕訳」ボタン押下で開くダイアログ方式へ変更)。すでに関連付けられている仕訳を
 * 行として一覧表示し、行自体をクリックすると遷移する(「詳細を見る」のような明示的な
 * ボタン文言には依存しない)。関連付け候補が存在する場合のみ「+ 関連仕訳を追加」行を表示し、
 * 押すとセレクトが現れ、候補を選んだ瞬間にonAddEntryを呼ぶ(CounterpartyQuickAddSelectと同じ
 * 「選択=即確定」方式、確定・キャンセルボタンは置かない)。将来的に仕訳数が増えた場合、
 * このセレクトは専用の仕訳検索画面に置き換える想定(現時点では対応しない)。
 */
export function RelatedEntriesDialog({
  relatedEntries,
  relateCandidates,
  onSelectEntry,
  onAddEntry,
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

        {relatedEntries.length === 0 ? (
          <p>{t('relatedEntriesEmpty')}</p>
        ) : (
          <ul className="related-entries-list">
            {relatedEntries.map((relatedEntry) => (
              <li key={relatedEntry.id}>
                <button
                  type="button"
                  className="related-entries-list-row"
                  onClick={() => onSelectEntry(relatedEntry)}
                >
                  <span className="related-entries-list-date">{relatedEntry.entryDate}</span>
                  <span className="related-entries-list-memo">{relatedEntry.memo ?? t('entryNoMemo')}</span>
                  <span className="related-entries-list-amount">{formatCurrency(calculateEntryTotal(relatedEntry), 'JPY')}</span>
                </button>
              </li>
            ))}
          </ul>
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
