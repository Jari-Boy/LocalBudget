import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import { findUnallocatedEntries } from '../../domain/expense-splitting/findUnallocatedEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './JournalEntryListScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
}

export interface JournalEntryListScreenProps {
  journalEntryRepository: JournalEntryFinder
  onSelectEntry: (entry: JournalEntry) => void
  /** 未割勘の仕訳に表示する「割勘する」ボタンを押した際に呼ばれる */
  onStartSplitting: (entry: JournalEntry) => void
  onBack: () => void
}

/** 借方/貸方という簿記用語を見せず、単一の取引金額として表示する(貸借は必ず一致するため借方合計で代表する) */
function calculateEntryTotal(entry: JournalEntry): number {
  return entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

/**
 * 確定済み仕訳一覧画面(計画Issue #40)。journal_entriesを日付・摘要・取引金額で
 * 一覧表示する。借方/貸方・仕訳明細といった複式簿記の概念はUI上に出さない
 * (docs/domain.md 1.1)。「元の支出仕訳を選ぶ」動線として割勘起票フォームからも
 * 再利用される想定。findUnallocatedEntries(docs/domain/expense-splitting.md 1.5節)で
 * 割勘対象候補を絞り込み、未割勘の仕訳にのみ「割勘する」ボタンを表示する。
 * 下書き一覧(JournalEntryDraftListScreen)とは別物。
 */
export function JournalEntryListScreen({
  journalEntryRepository,
  onSelectEntry,
  onStartSplitting,
  onBack,
}: JournalEntryListScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [entries, setEntries] = useState<JournalEntry[] | null>(null)
  const [unallocatedEntryIds, setUnallocatedEntryIds] = useState<Set<number> | null>(null)

  useEffect(() => {
    void Promise.resolve(journalEntryRepository.findAll()).then(async (allEntries) => {
      const linksByEntryId = new Map<number, JournalEntryLink[]>()
      await Promise.all(
        allEntries.map(async (entry) => {
          linksByEntryId.set(entry.id, await Promise.resolve(journalEntryRepository.listLinksForEntry(entry.id)))
        }),
      )
      setEntries(allEntries)
      setUnallocatedEntryIds(new Set(findUnallocatedEntries(allEntries, linksByEntryId).map((entry) => entry.id)))
    })
  }, [journalEntryRepository])

  if (entries === null || unallocatedEntryIds === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  return (
    <div className="journal-entry-list-screen">
      <h2>{t('entryListTitle')}</h2>

      {entries.length === 0 ? (
        <p>{t('entryListEmpty')}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <span>{entry.entryDate}</span>
              <span>{entry.memo ?? t('entryNoMemo')}</span>
              <span>{formatCurrency(calculateEntryTotal(entry), 'JPY')}</span>
              <button type="button" onClick={() => onSelectEntry(entry)}>
                {t('viewEntryDetail')}
              </button>
              {unallocatedEntryIds.has(entry.id) && (
                <button type="button" onClick={() => onStartSplitting(entry)}>
                  {t('startSplitting')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
