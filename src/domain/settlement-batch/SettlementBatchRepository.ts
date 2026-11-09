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
}
