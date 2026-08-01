import type {
  CreateExternalTransactionRefInput,
  ExternalTransactionRef,
} from './ExternalTransactionRef'

/**
 * 突合マスタ(external_transaction_refs)の永続化を担うRepositoryのポート(インターフェース)。
 * 同一account_id×external_idはDDL側のUNIQUE制約(docs/schema/reconciliation.sql)で強制されるため、
 * create()の実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる。
 * findByAccountAndExternalId/findByAccountは、外部明細取込の重複防止フロー
 * (docs/domain/statement-import.md 1.6)・残高照合(docs/domain/reconciliation.md 1.5)から
 * 呼び出される想定のクエリメソッドで、本Issue(#20)で追加した。
 */
export interface ExternalTransactionRefRepository {
  create(input: CreateExternalTransactionRefInput): ExternalTransactionRef
  findById(id: number): ExternalTransactionRef | null
  /** 重複防止(docs/domain/statement-import.md 1.6 手順2-3)用。存在しなければnull */
  findByAccountAndExternalId(accountId: number, externalId: string): ExternalTransactionRef | null
  /** 対象口座の突合レコード全件(残高照合の積み上げ・確定版候補サジェスト等に使う) */
  findByAccount(accountId: number): ExternalTransactionRef[]
}
