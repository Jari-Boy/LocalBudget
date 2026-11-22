import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { anyKeywordMatches, matchesKeyword } from './counterpartyKeywordModel'
import { resolveEligibleCounterpartyId, rowStatus, withCounterAccount, type ImportRowState } from './importRowModel'

/**
 * 「ほかの行にも適用」(計画Issue #207)。取引先の設定(キーワードの一覧と、キーワードごとの科目)を、
 * 取り込み中のほかの行へ画面上だけで反映する。DBには書かない。DB・DOM非依存の純粋関数。
 *
 * - 取引先: キーワードのどれか1つでも摘要に含み、取引先が未設定で手で触っていない行にだけ設定する。
 *   別の取引先に自動マッチした行・手で選んだ行・候補が複数ある曖昧な行は、自動確定しない原則(docs/domain/counterparties.md 1.3)
 *   により変えない。取引先を持てない科目(費用・収益以外)の行にも設定しない。
 * - 相手科目: この取引先を持ち、相手科目を手で選んでいない行にだけ、**摘要に一致したキーワードの科目**を入れる
 *   (複数のキーワードに一致するときは最も長いキーワード。計画Issue #219、docs/decisions.md 2026-11-16 決定11)。
 *   キーワードに一致しない行や、キーワードに科目が無いときは、相手科目を変えない。
 * - 確定済みの行と、取り込み済みで対象外の重複の行は変えない。
 * - 反映した項目は初期状態にも反映し、未保存の警告の誤検知と、確定時の二重のパターン学習を避ける。
 *   反映の対象でない項目(コメントなど)を手で編集していれば、その編集は未保存のまま残る。
 */

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/** 反映で変わりうる項目。変わった項目だけを初期状態に写す */
const SYNCED_KEYS = ['counterpartyId', 'initialCounterpartyId', 'counterAccountId', 'settlementBatchId', 'householdMemberId'] as const

/** 適用するキーワード1件。科目は、そのキーワードに紐づく費用・収益の科目(なければnull) */
export interface SettingsKeyword {
  text: string
  accountId: number | null
}

/** 適用する取引先の設定。キーワードはポップアップに表示中のもの(登録済み・入力中・摘要の提案)すべて */
export interface CounterpartySettings {
  counterpartyId: number
  keywords: readonly SettingsKeyword[]
}

export interface ApplyCounterpartySettingsResult {
  states: ImportRowState[]
  initialStates: ImportRowState[]
  /** 反映して値が変わった行数 */
  applied: number
}

export function applyCounterpartySettingsToRows(params: {
  states: readonly ImportRowState[]
  initialStates: readonly ImportRowState[]
  records: readonly RowRecord[]
  /** 各行の摘要(行と同じ並び) */
  descriptions: readonly string[]
  done: ReadonlySet<number>
  settings: CounterpartySettings
  accounts: readonly Account[]
}): ApplyCounterpartySettingsResult {
  const { states, initialStates, records, descriptions, done, settings, accounts } = params
  const keywordTexts = settings.keywords.map((k) => k.text)
  let applied = 0
  const nextInitials = [...initialStates]

  const nextStates = states.map((state, index) => {
    if (done.has(index) || ['duplicate', 'skipped'].includes(rowStatus(records[index], state))) return state
    let next = state

    if (
      next.counterpartyId === null &&
      next.initialCounterpartyId === null &&
      next.candidateCounterpartyIds.length === 0 &&
      next.candidateAccountIds.length === 0 &&
      anyKeywordMatches(keywordTexts, descriptions[index]) &&
      resolveEligibleCounterpartyId(settings.counterpartyId, next.counterAccountId, accounts) !== null
    ) {
      next = { ...next, counterpartyId: settings.counterpartyId, initialCounterpartyId: settings.counterpartyId }
    }

    // 摘要に一致したキーワードのうち、最も長いもののキーワードの科目
    const matched = settings.keywords
      .filter((k) => matchesKeyword(k.text, descriptions[index]))
      .sort((a, b) => b.text.length - a.text.length)[0]
    const keywordAccount =
      matched === undefined || matched.accountId === null ? undefined : accounts.find((a) => a.id === matched.accountId)
    if (
      keywordAccount !== undefined &&
      isCounterpartyEligibleCategory(keywordAccount.category) &&
      next.counterpartyId === settings.counterpartyId &&
      !next.counterAccountTouched &&
      next.counterAccountId !== keywordAccount.id
    ) {
      // 科目を手で選んだ扱いにはしない(キーワードの科目が変わればまた追従できるように)
      next = { ...withCounterAccount(next, keywordAccount.id, accounts), counterAccountTouched: false }
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
