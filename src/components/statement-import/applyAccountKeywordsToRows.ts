import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { anyKeywordMatches } from './counterpartyKeywordModel'
import { rowStatus, withCounterAccount, type ImportRowState } from './importRowModel'

/**
 * 科目のキーワードの「N行に適用」(計画Issue #219・#259)。科目のキーワードを、取り込み中の
 * ほかの行へ画面上だけで反映する(DBには書かない)。DB・DOM非依存の純粋関数。
 *
 * - 科目のキーワードのどれか1つでも摘要に含み、取引先が無く、相手科目が未設定で手で触っていない行にだけ、その科目を入れる。
 *   別の科目が推定された行・手で選んだ行・取引先がある行は、自動確定しない原則(docs/domain/counterparties.md 1.3)により変えない。
 * - 確定済みの行と、取り込み済みで対象外の重複の行、「この取引を保存しない」を選んだ行は変えない。
 * - 反映した行は初期状態にも反映し、未保存の警告の誤検知を避ける。反映の対象でない項目(コメントなど)を
 *   手で編集していれば、その編集は未保存のまま残る。
 */

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/** 反映で変わりうる項目。変わった項目だけを初期状態に写す */
const SYNCED_KEYS = ['counterAccountId', 'settlementBatchId', 'householdMemberId'] as const

export interface AccountKeywordSettings {
  accountId: number
  keywords: readonly string[]
}

export interface ApplyAccountKeywordsResult {
  states: ImportRowState[]
  initialStates: ImportRowState[]
  /** 反映して値が変わった行数 */
  applied: number
}

export function applyAccountKeywordsToRows(params: {
  states: readonly ImportRowState[]
  initialStates: readonly ImportRowState[]
  records: readonly RowRecord[]
  /** 各行の摘要(行と同じ並び) */
  descriptions: readonly string[]
  done: ReadonlySet<number>
  settings: AccountKeywordSettings
  accounts: readonly Account[]
  /**
   * trueなら、入力済みの行も上書きする(「N行を上書き」。計画Issue #291)。キーワードに一致する行は、取引先・手で選んだ科目・
   * 曖昧な候補があっても、この科目にする(候補は空にし、科目は手で選んだ扱いにしない)。確定済み・重複の行は対象外
   */
  overwrite?: boolean
}): ApplyAccountKeywordsResult {
  const { states, initialStates, records, descriptions, done, settings, accounts, overwrite = false } = params
  let applied = 0
  const nextInitials = [...initialStates]

  const nextStates = states.map((state, index) => {
    if (done.has(index) || ['duplicate', 'skipped'].includes(rowStatus(records[index], state))) return state
    if (overwrite) {
      if (!anyKeywordMatches(settings.keywords, descriptions[index])) return state
    } else if (
      state.counterpartyId !== null ||
      state.counterAccountId !== null ||
      state.counterAccountTouched ||
      // 候補が残っている曖昧な行は、自動確定しない原則(docs/domain/counterparties.md 1.3)により変えない(計画Issue #260)
      state.candidateCounterpartyIds.length > 0 ||
      state.candidateAccountIds.length > 0 ||
      !anyKeywordMatches(settings.keywords, descriptions[index])
    ) {
      return state
    }

    // 科目を手で選んだ扱いにはしない(確定時に、摘要が重ねてキーワード登録されないように)
    const next = {
      ...withCounterAccount(state, settings.accountId, accounts),
      counterAccountTouched: false,
      ...(overwrite ? { candidateAccountIds: [], candidateCounterpartyIds: [] } : {}),
    }
    if (overwrite && SYNCED_KEYS.every((key) => state[key] === next[key])) return state
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
