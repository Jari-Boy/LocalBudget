import type { Account } from '../../domain/account/Account'
import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { isStatementImportSettlementBatchAccount } from './statementImportEligibility'

/**
 * 明細取込画面の1行ごとの入力状態と、その操作(計画Issue #151、docs/domain/statement-import.md 1.5)。
 * 取引先は費用・収益の科目の行だけ、精算バッチは一時勘定の行だけ、既定の世帯メンバーを持つ科目の行は
 * 世帯メンバーを変えられない、という制約をここに集め、行ごとの変更と一括設定が同じ規則を通るようにする。
 * DB・DOM非依存の純粋関数。
 */

export type ApproximateDecision = 'unresolved' | 'confirmed_replacement' | 'different_transaction'

export interface ImportRowState {
  counterpartyId: number | null
  counterAccountId: number | null
  /** 相手科目をユーザーが手動で選んだか。trueの間は取引先の変更で相手科目を自動で追従させない(計画Issue #77) */
  counterAccountTouched: boolean
  /** 初期表示時に推定した取引先。確定時に、これと違う取引先を選んだ行だけをパターン登録の候補にする */
  initialCounterpartyId: number | null
  /** 摘要のパターンが複数の取引先に当たって決まらなかった場合の候補。1件も無ければ空 */
  candidateCounterpartyIds: number[]
  projectId: number | null
  householdMemberId: number | null
  settlementBatchId: number | null
  comment: string
  /** 取り込み済みと完全一致する行を、それでも取り込むか */
  includeDuplicate: boolean
  approximateDecision: ApproximateDecision
  /** パターン登録するか(モックアップの「パターン登録」) */
  learnOn: boolean
  /** 登録する文字列。nullなら摘要そのまま */
  learnPattern: string | null
  /** 取引先の既定の科目に、この行の相手科目を使うか(その場で追加した取引先のみ) */
  useAsDefaultAccount: boolean
}

export type RowStatus = 'new' | 'duplicate' | 'check'

export function createInitialRowState(params: {
  counterpartyId: number | null
  counterAccountId: number | null
  candidateCounterpartyIds: number[]
}): ImportRowState {
  return {
    counterpartyId: params.counterpartyId,
    counterAccountId: params.counterAccountId,
    counterAccountTouched: false,
    initialCounterpartyId: params.counterpartyId,
    candidateCounterpartyIds: params.candidateCounterpartyIds,
    projectId: null,
    householdMemberId: null,
    settlementBatchId: null,
    comment: '',
    includeDuplicate: false,
    approximateDecision: 'unresolved',
    // 摘要だけでは取引先が決まらなかった行は、既定でパターンを登録しない(誤った学習を避ける)
    learnOn: params.candidateCounterpartyIds.length < 2,
    learnPattern: null,
    useAsDefaultAccount: false,
  }
}

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

export function rowStatus(record: RowRecord, state: ImportRowState): RowStatus {
  if (record.isExactDuplicate && !state.includeDuplicate) return 'duplicate'
  if (record.approximateCandidates.length > 0 && state.approximateDecision === 'unresolved') return 'check'
  if (state.counterAccountId === null) return 'check'
  return 'new'
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
  return account !== undefined && isStatementImportSettlementBatchAccount(account)
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
  /** 選択されていたが対象外だった行数(重複の行、項目を持てない科目の行) */
  skipped: number
}

/**
 * 選択した行に一括で設定する。重複の行(対象外)や、その項目を持てない科目の行は変えず、件数で返す。
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
    if (rowStatus(records[index], state) === 'duplicate') {
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

/** 推定と違う取引先を選んだ行(推定が無かった行を含む)だけが、パターン登録の候補になる。 */
export function shouldOfferLearn(record: RowRecord, state: ImportRowState): boolean {
  if (record.isExactDuplicate && !state.includeDuplicate) return false
  return state.counterpartyId !== null && state.counterpartyId !== state.initialCounterpartyId
}

/** 登録する文字列は、正規化した摘要に含まれるものだけが有効(空は無効)。 */
export function isLearnPatternValid(pattern: string, description: string): boolean {
  const normalized = normalizeDescriptionForMatching(pattern)
  return normalized.length > 0 && normalizeDescriptionForMatching(description).includes(normalized)
}
