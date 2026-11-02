import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from './JournalEntryLinkGroup'

/**
 * 関連仕訳グループ(journal_entry_link_groups/journal_entry_link_group_memberships)の
 * 永続化を担うRepositoryのポート(インターフェース、計画Issue #138)。表示専用であり、
 * 残高計算・消込判定には一切関与しない。
 *
 * createGroup/addMemberはいずれも単独のプリミティブで、どちらを呼ぶべきかの判定
 * (既存グループへの参加か新規作成か)はplanJoinOrCreateGroups(ドメイン層の純粋関数)が
 * 担う。実装(joinOrCreateGroups)はfindGroupIdsForEntryでanchorEntryIdsの既存グループを
 * 調べ、planJoinOrCreateGroupsの結果に従ってcreateGroup/addMemberを呼び出す単一の
 * トランザクションとして提供する。
 *
 * メンバーが0件になったグループ(全メンバーの仕訳が削除された等)は、DBのトリガー
 * (docs/schema/journal.sql)により自動的に削除される(計画Issue #138の懸念点「グループに
 * 所属する仕訳が0件になった場合の後始末」への対応)。
 */
export interface JournalEntryLinkGroupRepository {
  /** journalEntryIds(2件以上)を全てメンバーとする新規グループを作成する */
  createGroup(journalEntryIds: readonly number[]): JournalEntryLinkGroup
  /** 既存グループにjournalEntryIdをメンバーとして追加する。既に追加済みの場合は何もしない */
  addMember(linkGroupId: number, journalEntryId: number): void
  /**
   * グループからjournalEntryIdを除外する。所属していない場合は何もしない。残りのメンバーが
   * 0件になった場合、グループ自体はDBトリガー(journal_entry_link_groups_delete_when_empty)
   * により自動的に削除される
   */
  removeMember(linkGroupId: number, journalEntryId: number): void
  /** 指定した仕訳が所属する全グループのidを返す(所属していなければ空配列) */
  findGroupIdsForEntry(journalEntryId: number): number[]
  /** 全グループの所属関係を返す(buildRelatedEntryIdsByEntryIdに渡すためのスナップショット) */
  findAllMemberships(): JournalEntryLinkGroupMembership[]
  /** 全グループ(id・name・createdAt)を返す(groupRelatedEntriesByLinkGroupに渡すためのスナップショット) */
  findAllGroups(): JournalEntryLinkGroup[]
  /** グループの表示名を変更する。nullまたは空文字を渡すと未設定(既定名表示)に戻す */
  renameGroup(linkGroupId: number, name: string | null): void
  /**
   * anchorEntryIdsの既存グループを調べ、planJoinOrCreateGroupsの判定に従って
   * newEntryIdsを既存グループへ参加させる、または全entryIdをまとめた新規グループを
   * 作成する。割勘・分割払いの仕訳作成時の自動グルーピング、仕訳詳細画面からの手動関連付け
   * (いずれも計画Issue #138)の両方から使われる単一のエントリポイント。
   */
  joinOrCreateGroups(anchorEntryIds: readonly number[], newEntryIds: readonly number[]): void
}
