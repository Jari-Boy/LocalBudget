import type {
  CreateJournalEntryInput,
  JournalEntry,
  UpdateJournalEntryInput,
} from './JournalEntry'

/**
 * 仕訳(journal_entries/journal_lines)の永続化を担うRepositoryのポート(インターフェース)。
 * 貸借バランス検証(assertJournalBalance)は実装(インフラ層)が書き込み前に必ず呼び出し、
 * 不一致ならUnbalancedJournalEntryErrorを投げてDBに一切書き込まない(docs/domain/journal.md 1.3)。
 * counterparty_idのPL科目限定制約等はDDL側のトリガー(docs/schema/journal.sql)で強制されるため、
 * 実装はそちらの制約違反例外をそのまま呼び出し元に伝播させる。
 */
export interface JournalEntryRepository {
  create(input: CreateJournalEntryInput): JournalEntry
  findById(id: number): JournalEntry | null
  findAll(): JournalEntry[]
  update(id: number, input: UpdateJournalEntryInput): JournalEntry
  delete(id: number): void
}
