import type { Counterparty, CreateCounterpartyInput, UpdateCounterpartyInput } from './Counterparty'

/**
 * 取引先(counterparties)の永続化を担うRepositoryのポート(インターフェース)。
 * 紐づく仕訳明細が存在する取引先の物理削除禁止トリガー等のドメインルールはDDL側
 * (docs/schema/counterparties.sql)で強制されるため、実装(インフラ層)は制約違反時の
 * 例外をそのまま呼び出し元に伝播させる(docs/domain/counterparties.md参照)。
 */
export interface CounterpartyRepository {
  create(input: CreateCounterpartyInput): Counterparty
  findById(id: number): Counterparty | null
  findAll(): Counterparty[]
  update(id: number, input: UpdateCounterpartyInput): Counterparty
  delete(id: number): void
  deactivate(id: number): Counterparty
  activate(id: number): Counterparty
  /**
   * お気に入り(計画Issue #231 フェーズ4)のidの一覧(id順)。選択欄の先頭の「★ お気に入り」に出す。
   * 無効の取引先も、お気に入りの状態は保つ(選択欄での表示は、従来どおり、無効なものを選択中以外は出さない)
   */
  findFavoriteIds(): number[]
  /** お気に入りの付け外し。表示専用で、ほかの項目は変えない。存在しないidを指定しても何も起きない */
  setFavorite(id: number, isFavorite: boolean): void

  /**
   * sourceIds(統合元、複数可)に紐づくjournal_lines・keyword_rules(取引先のキーワードルール)をtargetId(統合先)へ
   * 付け替え、統合元→統合先のペアごとにcounterparty_merge_logへ1行記録する
   * (docs/domain/counterparties.md 1.5a参照)。
   */
  merge(targetId: number, sourceIds: number[]): void
}
