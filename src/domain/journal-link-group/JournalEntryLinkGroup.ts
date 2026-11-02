/**
 * 関連仕訳グループ(計画Issue #138)。journal_entry_linksが担っていた「関連仕訳をユーザーが
 * 一覧表示できる」役割を置き換える、表示専用の軽量な多対多グルーピング。残高計算・消込判定
 * には一切関与しない(docs/domain/journal.md 1.8参照)。link_type(種別タグ)は持たず、
 * 「関連している」という緩い関係のみを表す。
 * nameはユーザーが任意で付けられる表示名(未設定はnull。UI側(RelatedEntriesDialog)では
 * nullの場合「グループ1」等の既定名を表示するが、その既定名はドメイン層では永続化しない)。
 */
export interface JournalEntryLinkGroup {
  id: number
  name: string | null
  createdAt: string
}

/**
 * 関連仕訳グループと仕訳(journal_entries)の中間テーブル(多対多)。1つの仕訳が複数の
 * グループに同時に所属できる(所属数の上限なし)。journal_entry_idはjournal_entriesへの
 * ON DELETE CASCADEで、仕訳削除時に自動的に取り除かれる。
 */
export interface JournalEntryLinkGroupMembership {
  id: number
  linkGroupId: number
  journalEntryId: number
  createdAt: string
}
