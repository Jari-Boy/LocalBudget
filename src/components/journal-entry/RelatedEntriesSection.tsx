import { useState } from 'react'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { RelatedEntryGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalFilterPanel, type JournalFilterOptions } from '../common/journal-filter/JournalFilterPanel'
import './RelatedEntriesSection.css'

export interface RelatedEntriesSectionProps {
  groups: readonly RelatedEntryGroup[]
  /** 絞り込み条件に合う、まだ関連付けていない仕訳 */
  findCandidates: (filter: JournalEntryFilter) => JournalEntry[]
  filterOptions: JournalFilterOptions
  onOpenEntry: (entry: JournalEntry) => void
  onRename: (groupId: number, name: string | null) => void
  onRemove: (groupId: number, entryId: number) => void
  /** 別のグループへ移す。targetGroupId が null のときは新しいグループを作る */
  onMove: (sourceGroupId: number, targetGroupId: number | null, entryId: number) => void
  onAdd: (entryId: number) => void
}

const NEW_GROUP = 'new'

const debitTotal = (entry: JournalEntry) =>
  entry.lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum + l.amount, 0)

/**
 * 仕訳の詳細の最下部に常に出す「関連仕訳」(計画Issue #152)。グループ単位で表示し、
 * グループ名の変更・解除・別グループへの移動・追加ができる。追加は、絞り込みパネルを開いた
 * ポップアップで条件を絞って選ぶ。ボタン起点のダイアログ(計画Issue #138)を置き換えた。
 */
export function RelatedEntriesSection({
  groups,
  findCandidates,
  filterOptions,
  onOpenEntry,
  onRename,
  onRemove,
  onMove,
  onAdd,
}: RelatedEntriesSectionProps) {
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [filter, setFilter] = useState<JournalEntryFilter>({})
  const candidates = isPopupOpen ? findCandidates(filter) : []

  return (
    <section id="related-entries" aria-label="関連仕訳" className="related-entries">
      <h3 className="related-entries__title">関連仕訳</h3>
      {groups.map((group, index) => (
        <div key={group.groupId} className="related-entries__group">
          <div className="related-entries__group-head">
            <input
              key={group.name ?? ''}
              className="related-entries__name"
              aria-label="グループ名"
              placeholder={`グループ${index + 1}`}
              defaultValue={group.name ?? ''}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next !== (group.name ?? '')) onRename(group.groupId, next === '' ? null : next)
              }}
            />
          </div>
          {group.entries.map((entry) => {
            const label = `${entry.entryDate} ${entry.memo ?? '(摘要なし)'}`
            return (
              <div key={entry.id} className="related-entries__member">
                <button type="button" className="related-entries__open" onClick={() => onOpenEntry(entry)}>
                  {label}
                </button>
                <span className="related-entries__amount">{formatCurrency(debitTotal(entry), entry.currency)}</span>
                {groups.length >= 1 && (
                  <select
                    className="related-entries__move"
                    aria-label={`${label}を別のグループへ移動`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value === '') return
                      onMove(group.groupId, e.target.value === NEW_GROUP ? null : Number(e.target.value), entry.id)
                    }}
                  >
                    <option value="">移動</option>
                    {groups
                      .map((g, i) => ({ g, i }))
                      .filter(({ g }) => g.groupId !== group.groupId)
                      .map(({ g, i }) => (
                        <option key={g.groupId} value={g.groupId}>
                          {g.name ?? `グループ${i + 1}`}
                        </option>
                      ))}
                    <option value={NEW_GROUP}>新しいグループ</option>
                  </select>
                )}
                <button
                  type="button"
                  className="related-entries__remove"
                  aria-label={`${label}を解除`}
                  onClick={() => onRemove(group.groupId, entry.id)}
                >
                  解除
                </button>
              </div>
            )
          })}
        </div>
      ))}
      {groups.length === 0 && <p className="related-entries__empty">関連付けられた仕訳はありません</p>}

      <div className="related-entries__add">
        <button
          type="button"
          className="related-entries__add-button"
          aria-expanded={isPopupOpen}
          onClick={() => setIsPopupOpen((open) => !open)}
        >
          + 関連付ける仕訳を追加
        </button>
        {isPopupOpen && (
          <div role="dialog" aria-label="関連付ける仕訳を選ぶ" className="related-entries__popup">
            <JournalFilterPanel filter={filter} onChange={setFilter} options={filterOptions} resultCount={candidates.length} />
            <div className="related-entries__candidates">
              {candidates.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="related-entries__candidate"
                  onClick={() => {
                    onAdd(entry.id)
                    setIsPopupOpen(false)
                  }}
                >
                  <span>
                    {entry.entryDate} {entry.memo ?? '(摘要なし)'}
                  </span>
                  <span className="related-entries__amount">{formatCurrency(debitTotal(entry), entry.currency)}</span>
                </button>
              ))}
              {candidates.length === 0 && <p className="related-entries__empty">条件に合う仕訳はありません</p>}
            </div>
            <div className="related-entries__popup-actions">
              <button type="button" className="related-entries__add-button" onClick={() => setIsPopupOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
