import type {
  CreateExternalTransactionRefInput,
  ExternalTransactionRef,
} from './ExternalTransactionRef'

/**
 * 突合マスタ(external_transaction_refs)の永続化を担うRepositoryのポート(インターフェース)。
 * 本Issue(#19)では取込確定時に1行書き込むためのcreate()のみを最小限で実装する。残高照合
 * (docs/domain/reconciliation.md 1.5)・原因不明差異への残高調整(1.6)等のA6固有の突合ドメイン
 * ロジックは引き続きスコープ外(別Issue)。
 * 同一account_id×external_idはDDL側のUNIQUE制約(docs/schema/reconciliation.sql)で強制されるため、
 * 実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる。
 */
export interface ExternalTransactionRefRepository {
  create(input: CreateExternalTransactionRefInput): ExternalTransactionRef
  findById(id: number): ExternalTransactionRef | null
}
