import type { CreateSettlementBatchInput, SettlementBatch, UpdateSettlementBatchInput } from './SettlementBatch'

/**
 * 精算バッチ(settlement_batches)の永続化を担うRepositoryのポート(インターフェース)。
 * typeのCHECK制約・紐づく仕訳明細が存在するバッチの物理削除禁止トリガー等のドメインルールは
 * DDL側(docs/schema/settlement_batches.sql)で強制されるため、実装(インフラ層)は制約違反時の
 * 例外をそのまま呼び出し元に伝播させる(docs/domain/settlement.md参照、計画Issue #133)。
 * updateはname(精算タブでのバッチ名の変更、計画Issue #153)とcounterparty_idを対象とする。割勘起票フォームでバッチをその場作成する時点では
 * まだ参加者(世帯外の相手)が確定していないことがあるため、確定後に設定し直せるようにする。
 */
export interface SettlementBatchRepository {
  create(input: CreateSettlementBatchInput): SettlementBatch
  findById(id: number): SettlementBatch | null
  findAll(): SettlementBatch[]
  update(id: number, input: UpdateSettlementBatchInput): SettlementBatch
  delete(id: number): void
  /** クローズする(is_activeを偽にする)。振替仕訳の作成は呼び出し側が行う(計画Issue #249) */
  deactivate(id: number): SettlementBatch
  /** 再オープンする(is_activeを真に戻す) */
  activate(id: number): SettlementBatch
  /** クローズ時に自動で作った振替仕訳(残りの残高を雑損失・雑収入へ振り替える仕訳)を、バッチに記録する */
  recordCloseEntries(batchId: number, journalEntryIds: readonly number[]): void
  /** バッチに記録した振替仕訳のid(仕訳が削除されていれば含まれない)。再オープンで削除する対象 */
  findCloseEntryIds(batchId: number): number[]
}
