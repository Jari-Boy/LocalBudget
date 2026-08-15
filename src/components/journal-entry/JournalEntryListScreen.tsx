import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './JournalEntryListScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}

export interface JournalEntryListScreenProps {
  journalEntryRepository: JournalEntryFinder
  onSelectEntry: (entry: JournalEntry) => void
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
 * 再利用される想定。下書き一覧(JournalEntryDraftListScreen)とは別物。
 */
export function JournalEntryListScreen({
  journalEntryRepository,
  onSelectEntry,
  onBack,
}: JournalEntryListScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [entries, setEntries] = useState<JournalEntry[] | null>(null)

  useEffect(() => {
    void Promise.resolve(journalEntryRepository.findAll()).then(setEntries)
  }, [journalEntryRepository])

  if (entries === null) {
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
