import type { Account } from '../../domain/account/Account'
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { anyKeywordMatches, matchesKeyword } from './counterpartyKeywordModel'
import { resolveEligibleCounterpartyId, rowStatus, withCounterAccount, type ImportRowState } from './importRowModel'

/**
 * 「N行に適用」(計画Issue #207・#259。もとは取引先の設定全体の「ほかの行にも適用」)。取引先の設定(キーワードと、キーワードごとの科目)を、
 * 取り込み中のほかの行へ画面上だけで反映する。DBには書かない。DB・DOM非依存の純粋関数。
 *
 * - 取引先: キーワードのどれか1つでも摘要に含み、取引先が未設定で手で触っていない行にだけ設定する。
 *   別の取引先に自動マッチした行・手で選んだ行・候補が複数ある曖昧な行は、自動確定しない原則(docs/domain/counterparties.md 1.3)
 *   により変えない。取引先を持てない科目(費用・収益以外)の行にも設定しない。
 * - 相手科目: この取引先を持ち、相手科目を手で選んでいない行にだけ、**摘要に一致したキーワードの科目**を入れる
 *   (複数のキーワードに一致するときは最も長いキーワード。計画Issue #219、docs/decisions/2026-11-16-06.md 2026-11-16 決定11)。
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
  /**
   * trueなら、取引先が未入力の行だけに入れる(キーワード1件ごとの「N行に適用」。計画Issue #259)。
   * すでに取引先がある行は、この取引先でも相手科目を変えない
   */
  fillOnly?: boolean
  /**
   * trueなら、すでにこの取引先を持つ行だけを対象にする(取引先は入れない)。キーワードの科目を変えたとき、
   * その科目へ追従させるのに使う(計画Issue #259)
   */
  followOnly?: boolean
  /**
   * trueなら、入力済みの行も上書きする(「N行を上書き」。計画Issue #291)。キーワードに一致する行は、取引先・手で選んだ科目・
   * 曖昧な候補があっても、この取引先とキーワードの科目にする(候補は空にし、科目は手で選んだ扱いにしない)。
   * キーワードに科目が無いときは相手科目を変えず、その科目で取引先を持てない行は変えない。確定済み・重複の行は対象外
   */
  overwrite?: boolean
  /** 対象から外す行(キーワードのポップアップを開いた行。この行は自分で入力・確認している) */
  excludeIndex?: number
}): ApplyCounterpartySettingsResult {
  const { states, initialStates, records, descriptions, done, settings, accounts, fillOnly = false, followOnly = false, overwrite = false, excludeIndex } = params
  const keywordTexts = settings.keywords.map((k) => k.text)
  let applied = 0
  const nextInitials = [...initialStates]

  /** 入力済みでも上書きする。変わった行はfinishで初期状態に写して返す */
  const overwriteRow = (state: ImportRowState, index: number): ImportRowState => {
    const matched = settings.keywords
      .filter((k) => matchesKeyword(k.text, descriptions[index]))
      .sort((a, b) => b.text.length - a.text.length)[0]
    if (matched === undefined) return state
    const keywordAccount = matched.accountId === null ? undefined : accounts.find((a) => a.id === matched.accountId)
    let next = state
    if (keywordAccount !== undefined && isCounterpartyEligibleCategory(keywordAccount.category)) {
      next = { ...withCounterAccount(next, keywordAccount.id, accounts), counterAccountTouched: false }
    }
    if (resolveEligibleCounterpartyId(settings.counterpartyId, next.counterAccountId, accounts) === null) return state
    next = {
      ...next,
      counterpartyId: settings.counterpartyId,
      initialCounterpartyId: settings.counterpartyId,
      candidateCounterpartyIds: [],
      candidateAccountIds: [],
    }
    // 画面に見える値が変わらない行は、元の行をそのまま返す(件数に数えない)
    const changed =
      state.counterpartyId !== next.counterpartyId ||
      state.counterAccountId !== next.counterAccountId ||
      state.candidateCounterpartyIds.length > 0 ||
      state.candidateAccountIds.length > 0
    return changed ? finish(state, next, index) : state
  }

  const finish = (state: ImportRowState, next: ImportRowState, index: number): ImportRowState => {
    applied++
    const initial = { ...nextInitials[index] }
    for (const key of SYNCED_KEYS) {
      if (state[key] !== next[key]) (initial as Record<string, unknown>)[key] = next[key]
    }
    nextInitials[index] = initial
    return next
  }

  const nextStates = states.map((state, index) => {
    if (index === excludeIndex || done.has(index) || ['duplicate', 'skipped'].includes(rowStatus(records[index], state))) return state
    if (fillOnly && state.counterpartyId !== null) return state
    if (followOnly && state.counterpartyId !== settings.counterpartyId) return state
    if (overwrite) return overwriteRow(state, index)
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

    return next === state ? state : finish(state, next, index)
  })

  return { states: nextStates, initialStates: nextInitials, applied }
}
