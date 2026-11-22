/**
 * 明細取込の一時保存(計画Issue #231 フェーズ3、docs/domain/statement-import.md 1.8)の、行ごとの入力の取り出しと重ね直し。
 * - 保存: 初期値(キーワードルールによる推定など)から変えた行の入力だけを、外部取引IDごとに集める
 * - 再開: いまの帳簿で計算し直した初期値の上に、保存した入力を重ねる。利用者の入力は推定より優先する。
 *   保存してから削除された科目・取引先・プロジェクトなどを指す入力は戻さず、その行の初期値に戻して「戻せなかった」と数える
 * DB・DOM非依存の純粋関数。
 */
import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import type { StatementImportDraftRowInput } from '../../domain/statement-import/StatementImportDraft'
import { isRowEdited, resolveEligibleCounterpartyId, type ImportRowState } from './importRowModel'

/** 保存する項目だけを取り出す。推定の記録(初期の取引先・取引先の候補)は、再開時に計算し直すので含めない */
export function extractDraftRowInput(state: ImportRowState): StatementImportDraftRowInput {
  return {
    counterpartyId: state.counterpartyId,
    counterAccountId: state.counterAccountId,
    counterAccountTouched: state.counterAccountTouched,
    projectId: state.projectId,
    householdMemberId: state.householdMemberId,
    settlementBatchId: state.settlementBatchId,
    comment: state.comment,
    includeDuplicate: state.includeDuplicate,
    approximateDecision: state.approximateDecision,
    replacementTargetId: state.replacementTargetId,
  }
}

/**
 * 保存する、行ごとの入力(外部取引ID → 初期値から変えた入力)。
 * 一覧の行(確定済みを除く)に加えて、取り込むファイルのチェックを外して一覧に出ていない行の入力の記憶(memory)も含める。
 * 同じ外部取引IDは、一覧の内容を優先する(一覧で初期値に戻した行は、古い記憶があっても保存しない)。
 */
export function collectDraftRowInputs(params: {
  externalIds: readonly string[]
  rows: readonly ImportRowState[]
  initialRows: readonly ImportRowState[]
  done: ReadonlySet<number>
  memory: ReadonlyMap<string, { state: ImportRowState; initial: ImportRowState }>
}): Record<string, StatementImportDraftRowInput> {
  const inputs: Record<string, StatementImportDraftRowInput> = {}
  for (const [externalId, { state, initial }] of params.memory) {
    if (isRowEdited(state, initial)) inputs[externalId] = extractDraftRowInput(state)
  }
  params.externalIds.forEach((externalId, index) => {
    if (!params.done.has(index) && isRowEdited(params.rows[index], params.initialRows[index])) {
      inputs[externalId] = extractDraftRowInput(params.rows[index])
    } else {
      delete inputs[externalId]
    }
  })
  return inputs
}

/** いま存在する(選べる)科目・取引先・プロジェクト・世帯メンバー・精算バッチのid。保存した入力の参照先の検証に使う */
export interface DraftReferenceIds {
  accountIds: ReadonlySet<number>
  counterpartyIds: ReadonlySet<number>
  projectIds: ReadonlySet<number>
  memberIds: ReadonlySet<number>
  batchIds: ReadonlySet<number>
}

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/**
 * 保存した入力を、計算し直した初期値(computed)の上に重ねる。droppedは、削除された参照先などで戻せなかった入力があったか。
 * - 参照先が存在しない入力は戻さず、その項目は初期値のままにする(行のほかの入力は戻す)
 * - 取引先は、相手科目が取引先を持てない科目(資産・負債)なら戻さない
 * - 似た取引の扱い・「置き換える」の対象は、いまその行に似た取引の候補があるときだけ戻す(完全重複の「取り込む」も同様)
 */
export function applyDraftRowInput(params: {
  computed: ImportRowState
  saved: StatementImportDraftRowInput
  record: RowRecord
  accounts: readonly Account[]
  valid: DraftReferenceIds
}): { state: ImportRowState; dropped: boolean } {
  const { computed, saved, record, accounts, valid } = params
  let dropped = false
  /** 参照先のidを検証する。nullは「なし」の選択なのでそのまま戻し、存在しないidは初期値に戻す */
  const reference = (savedId: number | null, exists: ReadonlySet<number>, fallback: number | null): number | null => {
    if (savedId === null) return null
    if (exists.has(savedId)) return savedId
    dropped = true
    return fallback
  }

  const accountMissing = saved.counterAccountId !== null && !valid.accountIds.has(saved.counterAccountId)
  const counterAccountId = reference(saved.counterAccountId, valid.accountIds, computed.counterAccountId)
  const counterpartyId = resolveEligibleCounterpartyId(
    reference(saved.counterpartyId, valid.counterpartyIds, computed.counterpartyId),
    counterAccountId,
    accounts,
  )

  const hasCandidates = record.approximateCandidates.length > 0
  let replacementTargetId: number | null = computed.replacementTargetId
  if (hasCandidates && saved.replacementTargetId !== null) {
    if (record.approximateCandidates.some((c) => c.journalEntryId === saved.replacementTargetId)) {
      replacementTargetId = saved.replacementTargetId
    } else {
      dropped = true
    }
  }

  // droppedは、すべての参照先の検証が済んでから返す(戻り値のオブジェクトの中で検証すると、数え漏れる)
  const projectId = reference(saved.projectId, valid.projectIds, computed.projectId)
  const householdMemberId = reference(saved.householdMemberId, valid.memberIds, computed.householdMemberId)
  const settlementBatchId = reference(saved.settlementBatchId, valid.batchIds, computed.settlementBatchId)

  return {
    dropped,
    state: {
      ...computed,
      counterpartyId,
      counterAccountId,
      counterAccountTouched: accountMissing ? computed.counterAccountTouched : saved.counterAccountTouched,
      projectId,
      householdMemberId,
      settlementBatchId,
      comment: saved.comment,
      includeDuplicate: record.isExactDuplicate ? saved.includeDuplicate : computed.includeDuplicate,
      approximateDecision: hasCandidates ? saved.approximateDecision : computed.approximateDecision,
      replacementTargetId,
    },
  }
}
