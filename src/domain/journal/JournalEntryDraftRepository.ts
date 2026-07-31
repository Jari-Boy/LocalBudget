import type { JournalEntry } from './JournalEntry'
import type {
  CreateJournalEntryDraftInput,
  JournalEntryDraft,
  UpdateJournalEntryDraftInput,
} from './JournalEntryDraft'
import type { JournalEntryRepository } from './JournalEntryRepository'

/**
 * 仕訳の下書き(journal_entry_drafts/journal_entry_draft_lines)の永続化を担う
 * Repositoryのポート(インターフェース、docs/domain/journal.md 3章)。
 * 下書きはバランス検証・必須項目チェックを一切課さない別集約であり、
 * JournalEntryRepositoryとは独立したCRUDライフサイクルを持つため別インターフェースに分離した。
 * 確定(confirm)時のみJournalEntryRepository.createを呼び出し、通常の貸借バランス検証・
 * is_reconcilable記帳制限を経由させる。createが失敗した場合、下書きは削除されず残る。
 */
export interface JournalEntryDraftRepository {
  create(input: CreateJournalEntryDraftInput): JournalEntryDraft
  findById(id: number): JournalEntryDraft | null
  findAll(): JournalEntryDraft[]
  update(id: number, input: UpdateJournalEntryDraftInput): JournalEntryDraft
  delete(id: number): void
  confirm(id: number, journalEntryRepository: JournalEntryRepository): JournalEntry
}
