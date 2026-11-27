import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'

/**
 * 明細取込画面の1行ごとの入力状態と、その操作(計画Issue #151、docs/domain/statement-import.md 1.5)。
 * 取引先は費用・収益の科目の行だけ、精算バッチは立替金・未払金の行だけ、既定の世帯メンバーを持つ科目の行は
 * 世帯メンバーを変えられない、という制約をここに集め、行ごとの変更と一括設定が同じ規則を通るようにする。
 * DB・DOM非依存の純粋関数。
 */

/**
 * 似た取引(確定版の可能性)がある行の扱い。既定は「別の取引なので、登録済みを残したまま追加する」。
 * 「置き換える」は登録済みの仕訳を1件削除してこの取引で置き換え、「保存しない」はこの行を取り込まない。
 */
export type ApproximateDecision = 'different_transaction' | 'confirmed_replacement' | 'skip'

export interface ImportRowState {
  counterpartyId: number | null
  counterAccountId: number | null
  /** 相手科目をユーザーが手動で選んだか。trueの間は取引先の変更で相手科目を自動で追従させない(計画Issue #77) */
  counterAccountTouched: boolean
  /** 初期表示時に推定した取引先。キーワードの「N行に適用」で、自動で一致した行を上書きしないための記録に使う */
  initialCounterpartyId: number | null
  /** 摘要のパターンが複数の取引先に当たって決まらなかった場合の候補。1件も無ければ空 */
  candidateCounterpartyIds: number[]
  /**
   * 摘要のキーワードが独立して重なり、取引先・相手科目とも決まらなかった(曖昧な)場合の、相手科目の候補。
   * 相手科目の選択欄の先頭に並べる(計画Issue #260)。1件も無ければ空
   */
  candidateAccountIds: number[]
  projectId: number | null
  householdMemberId: number | null
  settlementBatchId: number | null
  comment: string
  /** 取り込み済みと完全一致する行を、それでも取り込むか */
  includeDuplicate: boolean
  approximateDecision: ApproximateDecision
  /** 「置き換える」で削除する登録済みの仕訳。候補が複数あるときに選ぶ(候補が1件なら選ばなくてもその1件) */
  replacementTargetId: number | null
}

export type RowStatus = 'new' | 'duplicate' | 'check' | 'skipped'

/** 一覧の3グループ。取り込んだときの内容で決まり、操作しても動かない */
export type RowGroup = 'duplicate' | 'similar' | 'clean'

export function createInitialRowState(params: {
  counterpartyId: number | null
  counterAccountId: number | null
  candidateCounterpartyIds: number[]
  candidateAccountIds?: number[]
}): ImportRowState {
  return {
    counterpartyId: params.counterpartyId,
    counterAccountId: params.counterAccountId,
    counterAccountTouched: false,
    initialCounterpartyId: params.counterpartyId,
    candidateCounterpartyIds: params.candidateCounterpartyIds,
    candidateAccountIds: params.candidateAccountIds ?? [],
    projectId: null,
    householdMemberId: null,
    settlementBatchId: null,
    comment: '',
    includeDuplicate: false,
    approximateDecision: 'different_transaction',
    replacementTargetId: null,
  }
}

export type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/**
 * 初期状態から利用者が入力を変えたか(未保存の警告の判定、計画Issue #193)。推定した初期値のままなら
 * 失うものは無いので編集とみなさない。相手科目を手で選んだかの記録(counterAccountTouched)など、
 * 値が変わらないものは比較しない。
 */
export function isRowEdited(state: ImportRowState, initial: ImportRowState): boolean {
  return (
    state.counterpartyId !== initial.counterpartyId ||
    state.counterAccountId !== initial.counterAccountId ||
    state.projectId !== initial.projectId ||
    state.householdMemberId !== initial.householdMemberId ||
    state.settlementBatchId !== initial.settlementBatchId ||
    state.comment !== initial.comment ||
    state.includeDuplicate !== initial.includeDuplicate ||
    state.approximateDecision !== initial.approximateDecision ||
    state.replacementTargetId !== initial.replacementTargetId
  )
}

export function rowStatus(record: RowRecord, state: ImportRowState): RowStatus {
  if (record.isExactDuplicate && !state.includeDuplicate) return 'duplicate'
  if (record.approximateCandidates.length > 0 && state.approximateDecision === 'skip') return 'skipped'
  if (needsReplacementTarget(record, state)) return 'check'
  if (state.counterAccountId === null) return 'check'
  return 'new'
}

/** 「置き換える」を選んだのに、削除する登録済みの仕訳が決まっていない(候補が複数で未選択) */
function needsReplacementTarget(record: RowRecord, state: ImportRowState): boolean {
  return state.approximateDecision === 'confirmed_replacement' && record.approximateCandidates.length > 1 && replacementTargetOf(record, state) === null
}

/**
 * 「置き換える」で削除する登録済みの仕訳のid。「置き換える」以外では削除しないのでnull。
 * 候補が1件ならその1件、複数なら選んだ1件(選んでいない・候補に無い値はnull)。
 */
export function replacementTargetOf(record: RowRecord, state: ImportRowState): number | null {
  if (state.approximateDecision !== 'confirmed_replacement') return null
  if (record.approximateCandidates.length === 1) return record.approximateCandidates[0].journalEntryId
  const chosen = record.approximateCandidates.find((c) => c.journalEntryId === state.replacementTargetId)
  return chosen === undefined ? null : chosen.journalEntryId
}

/** 一覧のグループ。重複(取込済みとの完全一致)→似た取引あり→問題なしの順に並べて見せる */
export function rowGroup(record: RowRecord): RowGroup {
  if (record.isExactDuplicate) return 'duplicate'
  return record.approximateCandidates.length > 0 ? 'similar' : 'clean'
}

const findAccount = (accounts: readonly Account[], id: number | null) =>
  id === null ? undefined : accounts.find((a) => a.id === id)

/** 相手科目が費用・収益でなければ取引先を持てない(DDLトリガーと同じ制約)。未選択・候補外は判定できないのでそのまま。 */
export function resolveEligibleCounterpartyId(
  counterpartyId: number | null,
  counterAccountId: number | null,
  accounts: readonly Account[],
): number | null {
  const account = findAccount(accounts, counterAccountId)
  return account !== undefined && !isCounterpartyEligibleCategory(account.category) ? null : counterpartyId
}

export function isTaggableAccountId(accountId: number | null, accounts: readonly Account[]): boolean {
  const account = findAccount(accounts, accountId)
  return account !== undefined && isSettlementBatchTaggableAccount(account)
}

/** 科目に既定の世帯メンバーがあれば、明細側では変えられない(docs/domain/household-members.md 1.2)。 */
export function defaultMemberIdOf(accountId: number | null, accounts: readonly Account[]): number | null {
  return findAccount(accounts, accountId)?.householdMemberId ?? null
}

/** 相手科目を変えたときの、ほかの項目の整合(行ごとの変更と一括設定で共通) */
export function withCounterAccount(
  state: ImportRowState,
  counterAccountId: number | null,
  accounts: readonly Account[],
): ImportRowState {
  return {
    ...state,
    counterAccountId,
    counterpartyId: resolveEligibleCounterpartyId(state.counterpartyId, counterAccountId, accounts),
    counterAccountTouched: true,
    settlementBatchId: isTaggableAccountId(counterAccountId, accounts) ? state.settlementBatchId : null,
    householdMemberId: defaultMemberIdOf(counterAccountId, accounts) !== null ? null : state.householdMemberId,
  }
}

export type BulkChange =
  | { field: 'counterAccount'; value: number | null }
  | { field: 'counterparty'; value: number | null }
  | { field: 'project'; value: number | null }
  | { field: 'householdMember'; value: number | null }
  | { field: 'settlementBatch'; value: number | null }
  | { field: 'comment'; value: string }

export interface BulkResult {
  states: ImportRowState[]
  /** 設定した行数 */
  applied: number
  /** 選択されていたが対象外だった行数(重複の行、保存しない行、項目を持てない科目の行) */
  skipped: number
}

/**
 * 選択した行に一括で設定する。重複の行・保存しない行(対象外)や、その項目を持てない科目の行は変えず、件数で返す。
 */
export function applyBulkSetting(params: {
  states: readonly ImportRowState[]
  records: readonly RowRecord[]
  selected: ReadonlySet<number>
  accounts: readonly Account[]
  change: BulkChange
}): BulkResult {
  const { states, records, selected, accounts, change } = params
  let applied = 0
  let skipped = 0

  const next = states.map((state, index) => {
    if (!selected.has(index)) return state
    const status = rowStatus(records[index], state)
    if (status === 'duplicate' || status === 'skipped') {
      skipped++
      return state
    }
    const account = findAccount(accounts, state.counterAccountId)
    let updated: ImportRowState | null = null
    switch (change.field) {
      case 'counterAccount':
        updated = withCounterAccount(state, change.value, accounts)
        break
      case 'counterparty':
        if (account === undefined || isCounterpartyEligibleCategory(account.category)) {
          updated = { ...state, counterpartyId: change.value }
        }
        break
      case 'project':
        updated = { ...state, projectId: change.value }
        break
      case 'householdMember':
        if (defaultMemberIdOf(state.counterAccountId, accounts) === null) {
          updated = { ...state, householdMemberId: change.value }
        }
        break
      case 'settlementBatch':
        if (isTaggableAccountId(state.counterAccountId, accounts)) {
          updated = { ...state, settlementBatchId: change.value }
        }
        break
      case 'comment':
        updated = { ...state, comment: change.value }
        break
    }
    if (updated === null) {
      skipped++
      return state
    }
    applied++
    return updated
  })

  return { states: next, applied, skipped }
}
