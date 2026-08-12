import type { CounterpartyPattern, Counterparty, CreateCounterpartyInput, UpdateCounterpartyInput } from './Counterparty'

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

  /** CSV摘要文字列とのマッチング用パターンを取引先に追加する(docs/domain/counterparties.md 1.3参照) */
  addPattern(counterpartyId: number, pattern: string): CounterpartyPattern

  /** textに部分一致(LIKE '%pattern%')するパターンを検索する(docs/domain/counterparties.md 1.3参照) */
  findByPattern(text: string): CounterpartyPattern[]

  /** 指定した取引先に紐づく全パターンを列挙する(取引先管理画面でのパターン一覧表示用) */
  findPatternsByCounterparty(counterpartyId: number): CounterpartyPattern[]

  /** パターン文字列を更新する(誤学習の是正用) */
  updatePattern(patternId: number, pattern: string): CounterpartyPattern

  /** パターンを物理削除する(不要になったパターンの是正用、参照制約は無いため単純削除でよい) */
  deletePattern(patternId: number): void

  /**
   * sourceIds(統合元、複数可)に紐づくjournal_lines・counterparty_patternsをtargetId(統合先)へ
   * 付け替え、統合元→統合先のペアごとにcounterparty_merge_logへ1行記録する
   * (docs/domain/counterparties.md 1.5a参照)。
   */
  merge(targetId: number, sourceIds: number[]): void
}
