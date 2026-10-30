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
 * 扱う。リンクは明細行(journal_lines)単位で、from_line(消込・割勘する側)からto_line
 * (消込・割勘される側)へ張る(計画Issue #132)。settlesリンクの作成は消込仕訳自体の作成と同一
 * トランザクションで書き込む必要があるため(docs/domain/reconciliation.md 2.3)、別Repositoryに
 * 分離せず、CreateJournalEntryInput.linksを経由してcreate()内の単一トランザクションで
 * リンクも書き込めるようにしている(新しい仕訳の行はfromLineIndexで指す。検証に失敗した場合は
 * 仕訳・明細・リンクのいずれも書き込まれずROLLBACKされる)。createLinkは、既に存在する
 * 2つの明細行の間へ事後的にリンクを追加する場合のための別メソッドであり、こちらは独立した
 * トランザクションを持つ。リンク作成時は、科目一致・貸借が逆・from_lineの金額上限
 * (settlesはさらに一時勘定であることと世帯メンバー・取引先・プロジェクトの一致)を検証し、
 * 違反はSettlementTagMismatchError(settles)またはJournalEntryLinkLineErrorで拒否する。
 *
 * update()は明細行のidによる差分更新(計画Issue #132): idを指定した行は同じidのままUPDATEされ、
 * 行に紐づくリンクが維持される。id未指定の行は新規INSERT、入力から消えた既存行はDELETE
 * され、その行のリンクもON DELETE CASCADEで一緒に削除される。
 */
export interface JournalEntryRepository {
  create(input: CreateJournalEntryInput): JournalEntry
  findById(id: number): JournalEntry | null
  findAll(): JournalEntry[]
  update(id: number, input: UpdateJournalEntryInput): JournalEntry
  delete(id: number): void
  /**
   * project_id(docs/domain/projects.md 1章)にタグ付けされたjournal_linesを持つjournal_entriesを
   * 単一のDBトランザクションでまとめて物理削除する(all-or-nothing)。誤って投入した割勘バッチ
   * (docs/domain/expense-splitting.md 1.2)を丸ごと取り消す用途を想定している。対象の仕訳が
   * 精算済み(settlesリンクを持つ)かどうかによるガードは行わない(docs/domain/journal.md 1.5の
   * 「物理削除は常に許可する」方針をそのまま踏襲)。該当する仕訳が存在しない場合は何もしない。
   */
  deleteByProjectId(projectId: number): void
  createLink(input: CreateJournalEntryLinkInput): JournalEntryLink
  listLinksForEntry(entryId: number): JournalEntryLink[]
}
