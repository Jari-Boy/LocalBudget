import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { draftMatchesDescription, type CounterpartyDraft } from './counterpartyDraftModel'
import { resolveEligibleCounterpartyId, rowStatus, withCounterAccount, type ImportRowState } from './importRowModel'

/**
 * 「ほかの行にも適用」(計画Issue #207)。取引先の下書き(パターンの一覧と相手科目の初期値)を、
 * 取り込み中のほかの行へ画面上だけで反映する。DBには書かない。DB・DOM非依存の純粋関数。
 *
 * - 取引先: パターンのどれか1つでも摘要に含み、取引先が未設定で手で触っていない行にだけ設定する。
 *   別の取引先に自動マッチした行・手で選んだ行・候補が複数ある曖昧な行は、自動確定しない原則(docs/domain/counterparties.md 1.3)
 *   により変えない。取引先を持てない科目(費用・収益以外)の行にも設定しない。
 * - 相手科目: この取引先を持ち、相手科目を手で選んでいない行にだけ、下書きの初期値を設定する。
 * - 確定済みの行と、取り込み済みで対象外の重複の行は変えない。
 * - 反映した項目は初期状態にも反映し、未保存の警告の誤検知と、確定時の二重のパターン学習を避ける。
 *   反映の対象でない項目(コメントなど)を手で編集していれば、その編集は未保存のまま残る。
 */

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/** 反映で変わりうる項目。変わった項目だけを初期状態に写す */
const SYNCED_KEYS = ['counterpartyId', 'initialCounterpartyId', 'counterAccountId', 'settlementBatchId', 'householdMemberId'] as const

export interface ApplyCounterpartyDraftResult {
  states: ImportRowState[]
  initialStates: ImportRowState[]
  /** 反映して値が変わった行数 */
  applied: number
}

export function applyCounterpartyDraftToRows(params: {
  states: readonly ImportRowState[]
  initialStates: readonly ImportRowState[]
  records: readonly RowRecord[]
  /** 各行の摘要(行と同じ並び) */
  descriptions: readonly string[]
  done: ReadonlySet<number>
  draft: CounterpartyDraft
  accounts: readonly Account[]
}): ApplyCounterpartyDraftResult {
  const { states, initialStates, records, descriptions, done, draft, accounts } = params
  const defaultAccount =
    draft.defaultAccountId === null ? undefined : accounts.find((a) => a.id === draft.defaultAccountId)
  let applied = 0
  const nextInitials = [...initialStates]

  const nextStates = states.map((state, index) => {
    if (done.has(index) || rowStatus(records[index], state) === 'duplicate') return state
    let next = state

    if (
      next.counterpartyId === null &&
      next.initialCounterpartyId === null &&
      next.candidateCounterpartyIds.length < 2 &&
      draftMatchesDescription(draft, descriptions[index]) &&
      resolveEligibleCounterpartyId(draft.counterpartyId, next.counterAccountId, accounts) !== null
    ) {
      next = { ...next, counterpartyId: draft.counterpartyId, initialCounterpartyId: draft.counterpartyId }
    }

    if (
      defaultAccount !== undefined &&
      isCounterpartyEligibleCategory(defaultAccount.category) &&
      next.counterpartyId === draft.counterpartyId &&
      !next.counterAccountTouched &&
      next.counterAccountId !== defaultAccount.id
    ) {
      // 科目を手で選んだ扱いにはしない(取引先の初期値が変わればまた追従できるように)
      next = { ...withCounterAccount(next, defaultAccount.id, accounts), counterAccountTouched: false }
    }

    if (next === state) return state
    applied++
    const initial = { ...nextInitials[index] }
    for (const key of SYNCED_KEYS) {
      if (state[key] !== next[key]) (initial as Record<string, unknown>)[key] = next[key]
    }
    nextInitials[index] = initial
    return next
  })

  return { states: nextStates, initialStates: nextInitials, applied }
}
