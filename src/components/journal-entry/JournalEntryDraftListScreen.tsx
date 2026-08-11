import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JournalEntryDraft } from '../../domain/journal/JournalEntryDraft'
import './JournalEntryDraftListScreen.css'

interface JournalEntryDraftFinder {
  findAll(): JournalEntryDraft[] | Promise<JournalEntryDraft[]>
  delete(id: number): void | Promise<void>
}

export interface JournalEntryDraftListScreenProps {
  journalEntryDraftRepository: JournalEntryDraftFinder
  onResume: (draft: JournalEntryDraft) => void
  onNew: () => void
  onBack: () => void
}

/**
 * 仕訳下書き一覧画面(計画Issue #32)。journal_entry_draftsは複数件を並行して
 * 持てる設計(docs/domain/journal.md 3章)であり、1件に制限しない。シンプルな
 * リスト表示+再開+削除のみを提供し、検索・並び替え等の高度な機能は持たない
 * (MVPスコープ)。確定済み仕訳(journal_entries)の一覧表示・編集・削除UIとは
 * 別物であり、こちらは計画Issue #32のスコープ外(別Issueで扱う)。
 */
export function JournalEntryDraftListScreen({
  journalEntryDraftRepository,
  onResume,
  onNew,
  onBack,
}: JournalEntryDraftListScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')
  const [drafts, setDrafts] = useState<JournalEntryDraft[] | null>(null)

  useEffect(() => {
    void loadDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalEntryDraftRepository])

  async function loadDrafts(): Promise<void> {
    setDrafts(await journalEntryDraftRepository.findAll())
  }

  async function handleDelete(id: number): Promise<void> {
    await journalEntryDraftRepository.delete(id)
    await loadDrafts()
  }

  if (drafts === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  return (
    <div className="journal-entry-draft-list-screen">
      <h2>{t('draftListTitle')}</h2>

      {drafts.length === 0 ? (
        <p>{t('draftListEmpty')}</p>
      ) : (
        <ul>
          {drafts.map((draft) => (
            <li key={draft.id}>
              <span>{draft.entryDate ?? t('draftNoDate')}</span>
              <span>{draft.memo ?? t('draftNoMemo')}</span>
              <span>{t('draftLineCount', { count: draft.lines.length })}</span>
              <button type="button" onClick={() => onResume(draft)}>
                {t('resumeDraft')}
              </button>
              <button type="button" onClick={() => void handleDelete(draft.id)}>
                {t('deleteDraft')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onNew}>
        {t('newEntry')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
