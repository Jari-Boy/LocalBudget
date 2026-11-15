import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'

/**
 * 明細取込の「取引先の設定」ポップアップの下書き(計画Issue #207)。
 * 登録済みパターンの編集・削除、新規パターンの追加、相手科目の初期値の変更を、取引先ごとに1つ持つ。
 * 同じ取引先の行が複数あっても同じ内容が見えるよう、行ではなく取引先に紐づける。DBへは確定時にだけ書く。
 * DB・DOM非依存の純粋関数。
 */

export interface DraftPattern {
  /** 一覧の中で一意なキー(入力欄や削除ボタンの対象を特定する) */
  key: string
  /** 登録済みならパターンのid、新規ならnull */
  patternId: number | null
  /** 入力中の文字列 */
  text: string
  /** 登録済みの元の文字列(新規はnull)。編集したかの判定に使う */
  originalText: string | null
  /** 新規パターンの元になった行の摘要。「含まれる文字列のみ」の検証に使う(登録済みはnull) */
  sourceDescription: string | null
}

export interface CounterpartyDraft {
  counterpartyId: number
  patterns: DraftPattern[]
  /** 下書きを作った時点の相手科目の初期値。変えたかの判定に使う */
  originalDefaultAccountId: number | null
  defaultAccountId: number | null
  /** 画面上で消した登録済みパターンのid(確定時にDBから削除する) */
  deletedPatternIds: number[]
  nextKey: number
}

export type DraftPatternError = 'empty' | 'duplicate' | 'notInDescription'

export interface NewPatternSeed {
  text: string
  sourceDescription: string
}

export function createCounterpartyDraft(params: {
  counterpartyId: number
  defaultAccountId: number | null
  registered: readonly { id: number; pattern: string }[]
  initialNewPattern?: NewPatternSeed | null
}): CounterpartyDraft {
  const patterns: DraftPattern[] = params.registered.map((p, i) => ({
    key: `r${i}`,
    patternId: p.id,
    text: p.pattern,
    originalText: p.pattern,
    sourceDescription: null,
  }))
  const draft: CounterpartyDraft = {
    counterpartyId: params.counterpartyId,
    patterns,
    originalDefaultAccountId: params.defaultAccountId,
    defaultAccountId: params.defaultAccountId,
    deletedPatternIds: [],
    nextKey: 0,
  }
  return params.initialNewPattern ? addDraftPattern(draft, params.initialNewPattern) : draft
}

export function addDraftPattern(draft: CounterpartyDraft, seed: NewPatternSeed): CounterpartyDraft {
  const pattern: DraftPattern = {
    key: `n${draft.nextKey}`,
    patternId: null,
    text: seed.text,
    originalText: null,
    sourceDescription: seed.sourceDescription,
  }
  return { ...draft, patterns: [...draft.patterns, pattern], nextKey: draft.nextKey + 1 }
}

export function updateDraftPatternText(draft: CounterpartyDraft, key: string, text: string): CounterpartyDraft {
  return { ...draft, patterns: draft.patterns.map((p) => (p.key === key ? { ...p, text } : p)) }
}

export function removeDraftPattern(draft: CounterpartyDraft, key: string): CounterpartyDraft {
  const target = draft.patterns.find((p) => p.key === key)
  if (!target) return draft
  return {
    ...draft,
    patterns: draft.patterns.filter((p) => p.key !== key),
    deletedPatternIds: target.patternId === null ? draft.deletedPatternIds : [...draft.deletedPatternIds, target.patternId],
  }
}

export function setDraftDefaultAccount(draft: CounterpartyDraft, accountId: number | null): CounterpartyDraft {
  return { ...draft, defaultAccountId: accountId }
}

/**
 * パターンごとの問題を返す(問題のないパターンは含まない)。空、正規化後に他と同じ(後ろの方を重複とする)、
 * 新規なのに元の摘要に含まれない文字列、の3種類。登録済みパターンの編集には「摘要に含まれる」条件をかけない。
 * 追加したばかりで入力前の新規パターン(空文字・空白だけ)は未入力として無視し、問題にしない。
 * 登録済みパターンが空になった場合は「空」とする(消したいときは削除を使う)。
 */
export function validateDraftPatterns(draft: CounterpartyDraft): Map<string, DraftPatternError> {
  const errors = new Map<string, DraftPatternError>()
  const seen = new Set<string>()
  for (const pattern of draft.patterns) {
    const normalized = normalizeDescriptionForMatching(pattern.text)
    if (normalized.length === 0) {
      if (pattern.patternId !== null) errors.set(pattern.key, 'empty')
      continue
    }
    if (seen.has(normalized)) {
      errors.set(pattern.key, 'duplicate')
      continue
    }
    seen.add(normalized)
    if (pattern.sourceDescription !== null && !normalizeDescriptionForMatching(pattern.sourceDescription).includes(normalized)) {
      errors.set(pattern.key, 'notInDescription')
    }
  }
  return errors
}

export function isDraftValid(draft: CounterpartyDraft): boolean {
  return validateDraftPatterns(draft).size === 0
}

/** 下書きを作った時点から変わっているか(未保存の警告と、確定時に保存するかの判定に使う) */
export function isDraftDirty(draft: CounterpartyDraft): boolean {
  return (
    draft.deletedPatternIds.length > 0 ||
    draft.defaultAccountId !== draft.originalDefaultAccountId ||
    draft.patterns.some((p) => (p.patternId === null ? p.text.trim() !== '' : p.text !== p.originalText))
  )
}

export interface DraftSavePlan {
  deletePatternIds: number[]
  updatePatterns: { id: number; pattern: string }[]
  addPatterns: string[]
  /** 相手科目の初期値を変えるとき、{ value }で新しい値(未設定ならnull)を返す。変えないときはnull */
  defaultAccountId: { value: number | null } | null
}

/** 確定時にDBへ書く内容に分ける。前後の空白は除く。保存の順序は 削除→更新→追加(同じ文字列への付け替えで重複しないため) */
export function planDraftSave(draft: CounterpartyDraft): DraftSavePlan {
  return {
    deletePatternIds: [...draft.deletedPatternIds],
    updatePatterns: draft.patterns
      .filter((p): p is DraftPattern & { patternId: number } => p.patternId !== null && p.text !== p.originalText)
      .map((p) => ({ id: p.patternId, pattern: p.text.trim() })),
    addPatterns: draft.patterns.filter((p) => p.patternId === null && p.text.trim() !== '').map((p) => p.text.trim()),
    defaultAccountId: draft.defaultAccountId !== draft.originalDefaultAccountId ? { value: draft.defaultAccountId } : null,
  }
}

/** パターン(正規化して部分一致)を含む摘要の数。空のパターンはどの摘要にも含まれないものとして数える */
export function countRowsContaining(text: string, descriptions: readonly string[]): number {
  const normalized = normalizeDescriptionForMatching(text)
  if (normalized.length === 0) return 0
  return descriptions.filter((d) => normalizeDescriptionForMatching(d).includes(normalized)).length
}

/** 下書きのパターンのどれか1つでも摘要に含まれるか(OR)。空のパターンは無視する */
export function draftMatchesDescription(draft: CounterpartyDraft, description: string): boolean {
  const normalizedDescription = normalizeDescriptionForMatching(description)
  return draft.patterns.some((p) => {
    const normalized = normalizeDescriptionForMatching(p.text)
    return normalized.length > 0 && normalizedDescription.includes(normalized)
  })
}
