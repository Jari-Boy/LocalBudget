import type {
  CreateJournalEntryInput,
  JournalEntry,
  UpdateJournalEntryInput,
} from './JournalEntry'
import type { CreateJournalEntryLinkInput, JournalEntryLink } from './JournalEntryLink'

/**
 * 仕訳(journal_entries/journal_lines)の永続化を担うRepositoryのポート(インターフェース)。
 * 貸借バランス検証(assertJournalBalance)は実装(インフラ層)が書き込み前に必ず呼び出し、
 * 不一致ならUnbalancedJournalEntryErrorを投げてDBに一切書き込まない(docs/domain/journal.md 1.3)。
 * is_reconcilable資産・負債への直接記帳制限(docs/domain/reconciliation.md 1.2)違反時は
 * RestrictedAccountPostingErrorを投げる。
 * counterparty_idのPL科目限定制約等はDDL側のトリガー(docs/schema/journal.sql)で強制されるため、
 * 実装はそちらの制約違反例外をそのまま呼び出し元に伝播させる。
 *
 * 仕訳間の関係(journal_entry_links、docs/domain/journal.md 1.8・2.3)も本Repositoryのメソッドとして
 * 扱う。settlesリンクの作成は消込仕訳自体の作成と同一トランザクションで書き込む必要があり
 * (docs/domain/reconciliation.md 2.3)、別Repositoryに分離するとトランザクション境界を跨ぐため。
 */
export interface JournalEntryRepository {
  create(input: CreateJournalEntryInput): JournalEntry
  findById(id: number): JournalEntry | null
  findAll(): JournalEntry[]
  update(id: number, input: UpdateJournalEntryInput): JournalEntry
  delete(id: number): void
  createLink(input: CreateJournalEntryLinkInput): JournalEntryLink
  listLinksForEntry(entryId: number): JournalEntryLink[]
}
