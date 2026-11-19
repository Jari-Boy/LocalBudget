import type {
  SaveStatementImportDraftInput,
  StatementImportDraft,
  StatementImportDraftSummary,
} from './StatementImportDraft'

/**
 * 明細取込の一時保存のRepository(ドメイン層のポート、計画Issue #231 フェーズ3)。
 * 一時保存は取込先の科目ごとに1つ。journal_entry_drafts(1仕訳ごとの途中保存)とは別物で、
 * external_transaction_refs と結びつかず、重複判定には効かない(確定済みの行は再開時に重複として自動で除外される)。
 */
export interface StatementImportDraftRepository {
  /** 一時保存の要約の一覧。最後に保存した日時の新しい順 */
  findSummaries(): StatementImportDraftSummary[]
  findById(id: number): StatementImportDraft | null
  /** 取込先の科目の一時保存の要約。無ければnull */
  findByAccountId(accountId: number): StatementImportDraftSummary | null
  /** 保存する。同じ取込先の一時保存があれば上書きする(idは保つ)。保存したものを返す */
  save(input: SaveStatementImportDraftInput): StatementImportDraft
  delete(id: number): void
}
