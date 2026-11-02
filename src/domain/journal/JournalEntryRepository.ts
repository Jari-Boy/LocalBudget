import type {
  CreateJournalEntryInput,
  JournalEntry,
  UpdateJournalEntryInput,
} from './JournalEntry'

/**
 * 仕訳(journal_entries/journal_lines)の永続化を担うRepositoryのポート(インターフェース)。
 * 貸借バランス検証(assertJournalBalance)は実装(インフラ層)が書き込み前に必ず呼び出し、
 * 不一致ならUnbalancedJournalEntryErrorを投げてDBに一切書き込まない(docs/domain/journal.md 1.3)。
 * is_reconcilable資産・負債への直接記帳制限(docs/domain/reconciliation.md 1.2)違反時は
 * RestrictedAccountPostingErrorを投げる。
 * counterparty_idのPL科目限定制約等はDDL側のトリガー(docs/schema/journal.sql)で強制されるため、
 * 実装はそちらの制約違反例外をそのまま呼び出し元に伝播させる。
 *
 * 仕訳間の関係(journal_entry_links、明細行単位のsettles/allocatesリンク)は計画Issue #138で
 * 完全に撤廃した。残高計算・消込判定はsettlement_batch_idタグの集計方式(計画Issue #133、
 * docs/domain/settlement.md参照)に、関連仕訳の一覧表示は関連仕訳グループ(多対多、
 * JournalEntryLinkGroupRepository、docs/domain/journal.md 1.8参照)にそれぞれ移管済み。
 *
 * update()は明細行のidによる差分更新(計画Issue #132): idを指定した行は同じidのままUPDATEされる。
 * id未指定の行は新規INSERT、入力から消えた既存行はDELETEされる。
 */
export interface JournalEntryRepository {
  create(input: CreateJournalEntryInput): JournalEntry
  findById(id: number): JournalEntry | null
  findAll(): JournalEntry[]
  update(id: number, input: UpdateJournalEntryInput): JournalEntry
  delete(id: number): void
  /**
   * settlement_batch_id(docs/domain/settlement.md、計画Issue #133)にタグ付けされた
   * journal_linesを持つjournal_entriesを単一のDBトランザクションでまとめて物理削除する
   * (all-or-nothing)。誤って投入した割勘バッチ(docs/domain/expense-splitting.md 1.2)を
   * 丸ごと取り消す用途を想定している。対象の仕訳が精算済みかどうかによるガードは行わない
   * (docs/domain/journal.md 1.5の「物理削除は常に許可する」方針をそのまま踏襲)。該当する
   * 仕訳が存在しない場合は何もしない。
   */
  deleteBySettlementBatchId(settlementBatchId: number): void
}
