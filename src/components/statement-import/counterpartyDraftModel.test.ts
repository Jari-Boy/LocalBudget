/**
 * counterpartyDraftModel(明細取込の「取引先の設定」ポップアップの下書き、計画Issue #207)の単体テスト。
 * 取引先ごとに1つ持つ下書き(登録済みパターンの編集・削除、新規パターンの追加、相手科目の初期値)の
 * 操作・検証(空・重複・新規は摘要に含まれる文字列のみ)・変更の有無・確定時に保存する内容への変換と、
 * パターンを含む明細の行数の数え方を確認する。DB・DOM非依存の純粋関数のみを対象とし、外部依存はない。
 */
import { describe, expect, it } from 'vitest'
import {
  addDraftPattern,
  countRowsContaining,
  createCounterpartyDraft,
  draftMatchesDescription,
  isDraftDirty,
  isDraftValid,
  planDraftSave,
  removeDraftPattern,
  setDraftDefaultAccount,
  updateDraftPatternText,
  validateDraftPatterns,
} from './counterpartyDraftModel'

const baseDraft = () =>
  createCounterpartyDraft({
    counterpartyId: 1,
    defaultAccountId: 10,
    registered: [
      { id: 100, pattern: 'SHINBUN-A' },
      { id: 101, pattern: '新聞販売店A 本店' },
    ],
  })

describe('createCounterpartyDraft', () => {
  it('登録済みパターンを一覧に並べ、変更・追加・削除のない状態で作る', () => {
    const draft = baseDraft()

    expect(draft.patterns.map((p) => [p.patternId, p.text])).toEqual([
      [100, 'SHINBUN-A'],
      [101, '新聞販売店A 本店'],
    ])
    expect(draft.defaultAccountId).toBe(10)
    expect(isDraftDirty(draft)).toBe(false)
  })

  it('最初の新規パターンを渡すと、登録済みの後ろに新規として並べる', () => {
    const draft = createCounterpartyDraft({
      counterpartyId: 1,
      defaultAccountId: null,
      registered: [{ id: 100, pattern: 'SHINBUN-A' }],
      initialNewPattern: { text: 'ネット銀行 新聞販売店A', sourceDescription: 'ネット銀行 新聞販売店A 1234' },
    })

    expect(draft.patterns.map((p) => [p.patternId, p.text])).toEqual([
      [100, 'SHINBUN-A'],
      [null, 'ネット銀行 新聞販売店A'],
    ])
    expect(isDraftDirty(draft)).toBe(true)
  })
})

describe('下書きの操作', () => {
  it('新規パターンを追加すると、一意なキーつきで末尾に並ぶ', () => {
    const draft = addDraftPattern(baseDraft(), { text: '日経', sourceDescription: '日経購読料' })

    expect(draft.patterns).toHaveLength(3)
    expect(draft.patterns[2]).toMatchObject({ patternId: null, text: '日経', sourceDescription: '日経購読料' })
    expect(new Set(draft.patterns.map((p) => p.key)).size).toBe(3)
  })

  it('パターンの文字列を編集できる', () => {
    const draft = baseDraft()
    const edited = updateDraftPatternText(draft, draft.patterns[0].key, 'SHINBUN-B')

    expect(edited.patterns[0].text).toBe('SHINBUN-B')
    expect(edited.patterns[0].originalText).toBe('SHINBUN-A')
  })

  it('登録済みパターンを削除すると、一覧から消えて削除する対象のidに残る', () => {
    const draft = baseDraft()
    const removed = removeDraftPattern(draft, draft.patterns[0].key)

    expect(removed.patterns.map((p) => p.patternId)).toEqual([101])
    expect(removed.deletedPatternIds).toEqual([100])
  })

  it('新規パターンを削除すると、一覧から消えるだけで削除する対象のidには何も増えない', () => {
    const added = addDraftPattern(baseDraft(), { text: '日経', sourceDescription: '日経購読料' })
    const removed = removeDraftPattern(added, added.patterns[2].key)

    expect(removed.patterns).toHaveLength(2)
    expect(removed.deletedPatternIds).toEqual([])
    expect(isDraftDirty(removed)).toBe(false)
  })

  it('相手科目の初期値を変えられる(未設定にも戻せる)', () => {
    expect(setDraftDefaultAccount(baseDraft(), 20).defaultAccountId).toBe(20)
    expect(setDraftDefaultAccount(baseDraft(), null).defaultAccountId).toBeNull()
  })
})

describe('validateDraftPatterns', () => {
  it('登録済みパターンを空文字・空白だけにすると「空」として検出する(消したいときは削除を使う)', () => {
    const draft = baseDraft()
    const edited = updateDraftPatternText(draft, draft.patterns[0].key, '  ')

    expect(validateDraftPatterns(edited).get(edited.patterns[0].key)).toBe('empty')
  })

  it('追加したばかりで入力前の新規パターン(空文字・空白だけ)は、未入力として扱い、問題にしない', () => {
    const draft = addDraftPattern(baseDraft(), { text: '  ', sourceDescription: '日経購読料' })

    expect(validateDraftPatterns(draft).size).toBe(0)
  })

  it('正規化(全角半角・大文字小文字・空白)したときに他のパターンと同じなら、後ろの方を「重複」として検出する', () => {
    const draft = addDraftPattern(baseDraft(), { text: 'shinbun-a', sourceDescription: 'SHINBUN-A 引落' })
    const errors = validateDraftPatterns(draft)

    expect(errors.get(draft.patterns[2].key)).toBe('duplicate')
    expect(errors.has(draft.patterns[0].key)).toBe(false)
  })

  it('新規パターンは、元の摘要に含まれない文字列なら「摘要に含まれない」として検出する', () => {
    const draft = addDraftPattern(baseDraft(), { text: '日経新聞', sourceDescription: '日経購読料' })

    expect(validateDraftPatterns(draft).get(draft.patterns[2].key)).toBe('notInDescription')
  })

  it('新規パターンが元の摘要の一部なら、全角半角や空白の違いがあっても有効', () => {
    const draft = addDraftPattern(baseDraft(), { text: '日経 ｺｳﾄﾞｸﾘｮｳ', sourceDescription: '内容:日経コウドクリョウ' })

    expect(validateDraftPatterns(draft).size).toBe(0)
  })

  it('登録済みパターンの編集には「摘要に含まれる」条件をかけない', () => {
    const draft = baseDraft()
    const edited = updateDraftPatternText(draft, draft.patterns[0].key, '今回の摘要に無い文字列')

    expect(validateDraftPatterns(edited).size).toBe(0)
    expect(isDraftValid(edited)).toBe(true)
  })

  it('問題がなければ有効で、1件でも問題があれば無効', () => {
    expect(isDraftValid(baseDraft())).toBe(true)
    expect(isDraftValid(addDraftPattern(baseDraft(), { text: '', sourceDescription: 'x' }))).toBe(true)
    expect(isDraftValid(addDraftPattern(baseDraft(), { text: 'y', sourceDescription: 'x' }))).toBe(false)
  })
})

describe('isDraftDirty', () => {
  it('登録済みパターンを元の文字列に戻せば、変更なしに戻る', () => {
    const draft = baseDraft()
    const edited = updateDraftPatternText(draft, draft.patterns[0].key, 'X')
    const reverted = updateDraftPatternText(edited, edited.patterns[0].key, 'SHINBUN-A')

    expect(isDraftDirty(edited)).toBe(true)
    expect(isDraftDirty(reverted)).toBe(false)
  })

  it('登録済みの削除・相手科目の初期値の変更・新規パターンの追加のいずれでも変更ありになる', () => {
    expect(isDraftDirty(removeDraftPattern(baseDraft(), baseDraft().patterns[0].key))).toBe(true)
    expect(isDraftDirty(setDraftDefaultAccount(baseDraft(), 99))).toBe(true)
    expect(isDraftDirty(addDraftPattern(baseDraft(), { text: 'a', sourceDescription: 'a' }))).toBe(true)
  })

  it('追加したばかりで入力前の新規パターンだけなら、変更なしのまま', () => {
    expect(isDraftDirty(addDraftPattern(baseDraft(), { text: ' ', sourceDescription: 'a' }))).toBe(false)
  })

  it('相手科目の初期値を変えてから元に戻せば、変更なしに戻る', () => {
    expect(isDraftDirty(setDraftDefaultAccount(setDraftDefaultAccount(baseDraft(), 99), 10))).toBe(false)
  })
})

describe('planDraftSave', () => {
  it('削除・更新・追加するパターンと、変えた相手科目の初期値に分けて返す(前後の空白は除く)', () => {
    let draft = baseDraft()
    draft = removeDraftPattern(draft, draft.patterns[0].key)
    draft = updateDraftPatternText(draft, draft.patterns[0].key, '  新聞販売店A 駅前店 ')
    draft = addDraftPattern(draft, { text: ' 日経 ', sourceDescription: '日経購読料' })
    draft = setDraftDefaultAccount(draft, 20)

    expect(planDraftSave(draft)).toEqual({
      deletePatternIds: [100],
      updatePatterns: [{ id: 101, pattern: '新聞販売店A 駅前店' }],
      addPatterns: ['日経'],
      defaultAccountId: { value: 20 },
    })
  })

  it('入力前の新規パターン(空文字・空白だけ)は、保存する内容に含めない', () => {
    const draft = addDraftPattern(baseDraft(), { text: ' ', sourceDescription: 'a' })

    expect(planDraftSave(draft).addPatterns).toEqual([])
  })

  it('何も変えていなければ、保存する内容は空で、相手科目の初期値も変えない', () => {
    expect(planDraftSave(baseDraft())).toEqual({
      deletePatternIds: [],
      updatePatterns: [],
      addPatterns: [],
      defaultAccountId: null,
    })
  })

  it('相手科目の初期値を未設定に戻した場合は、nullへの変更として返す', () => {
    expect(planDraftSave(setDraftDefaultAccount(baseDraft(), null)).defaultAccountId).toEqual({ value: null })
  })
})

describe('countRowsContaining / draftMatchesDescription', () => {
  const descriptions = ['ネット銀行 新聞販売店A 日経購読料', 'ネット銀行 新聞販売店A', '別の店B', 'カード スーパーC']

  it('パターンを含む摘要の数を、正規化したうえで数える', () => {
    expect(countRowsContaining('新聞販売店a', descriptions)).toBe(2)
    expect(countRowsContaining('ネット銀行', descriptions)).toBe(2)
    expect(countRowsContaining('存在しない', descriptions)).toBe(0)
  })

  it('空のパターンはどの摘要にも含まれないものとして数える', () => {
    expect(countRowsContaining('  ', descriptions)).toBe(0)
  })

  it('下書きのパターンのどれか1つでも含めば一致する(OR)。空のパターンは無視する', () => {
    let draft = baseDraft()
    draft = addDraftPattern(draft, { text: '日経', sourceDescription: '日経購読料' })
    draft = addDraftPattern(draft, { text: '', sourceDescription: '日経購読料' })

    expect(draftMatchesDescription(draft, '日経購読料 引落')).toBe(true)
    expect(draftMatchesDescription(draft, 'shinbun-a 3月')).toBe(true)
    expect(draftMatchesDescription(draft, '別の店B')).toBe(false)
  })
})
