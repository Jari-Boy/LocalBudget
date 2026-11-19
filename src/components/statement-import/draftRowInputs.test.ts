/**
 * draftRowInputs(明細取込の一時保存の、行ごとの入力の取り出しと重ね直し、計画Issue #231 フェーズ3)のユニットテスト。
 * 保存するのは、初期値(キーワードルールによる推定など)から変えた行の入力だけを、外部取引IDごとに持つこと、
 * 再開時は、いまの帳簿で計算し直した初期値の上に保存した入力を重ねて、利用者の入力を推定より優先すること、
 * 保存してから削除された科目・取引先・プロジェクトなどを指す入力は戻さず、その行の初期値に戻して件数に数えることを検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { createInitialRowState, type ImportRowState } from './importRowModel'
import {
  applyDraftRowInput,
  collectDraftRowInputs,
  extractDraftRowInput,
  type DraftReferenceIds,
} from './draftRowInputs'

const account = (id: number, category: Account['category'], name = `科目${id}`) =>
  ({ id, category, name, isActive: true, isSystemManaged: false, householdMemberId: null }) as Account

const FOOD = account(1, 'expense', '食費')
const CARD = account(2, 'liability', '楽天VISA')
const ACCOUNTS = [FOOD, CARD]

const VALID: DraftReferenceIds = {
  accountIds: new Set([1, 2]),
  counterpartyIds: new Set([10, 11]),
  projectIds: new Set([20]),
  memberIds: new Set([30]),
  batchIds: new Set([40]),
}

const state = (overrides: Partial<ImportRowState> = {}): ImportRowState => ({
  ...createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }),
  ...overrides,
})

const record = (overrides: Partial<{ isExactDuplicate: boolean; approximateCandidates: { journalEntryId: number }[] }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

describe('extractDraftRowInput', () => {
  it('保存する項目だけを取り出し、推定の記録(初期の取引先・取引先の候補)は含めない', () => {
    const input = extractDraftRowInput(
      state({ counterAccountId: 1, comment: 'メモ', initialCounterpartyId: 10, candidateCounterpartyIds: [10, 11] }),
    )

    expect(input).toMatchObject({ counterAccountId: 1, comment: 'メモ' })
    expect(input).not.toHaveProperty('initialCounterpartyId')
    expect(input).not.toHaveProperty('candidateCounterpartyIds')
  })
})

describe('collectDraftRowInputs', () => {
  const initial = state()

  it('初期値から変えた行だけを、外部取引IDごとに集める(確定済みの行と、変えていない行は含めない)', () => {
    const rows = [state({ counterAccountId: 1 }), state(), state({ comment: '確定済み' })]

    const inputs = collectDraftRowInputs({
      externalIds: ['a', 'b', 'c'],
      rows,
      initialRows: [initial, initial, initial],
      done: new Set([2]),
      memory: new Map(),
    })

    expect(Object.keys(inputs)).toEqual(['a'])
    expect(inputs.a.counterAccountId).toBe(1)
  })

  it('取り込むファイルのチェックを外して一覧に出ていない行(入力の記憶)も、変えていれば集める。一覧にある行の内容が優先される', () => {
    const memory = new Map([
      ['hidden', { state: state({ comment: '外したファイルの行' }), initial }],
      ['a', { state: state({ comment: '古い記憶' }), initial }],
    ])

    const inputs = collectDraftRowInputs({
      externalIds: ['a'],
      rows: [state({ comment: '一覧の内容' })],
      initialRows: [initial],
      done: new Set(),
      memory,
    })

    expect(inputs.hidden.comment).toBe('外したファイルの行')
    expect(inputs.a.comment).toBe('一覧の内容')
  })
})

describe('applyDraftRowInput', () => {
  const computed = state({ counterpartyId: 10, counterAccountId: 1, initialCounterpartyId: 10, candidateCounterpartyIds: [] })

  const apply = (savedOverrides: Partial<ImportRowState>, rec = record(), base = computed) =>
    applyDraftRowInput({
      computed: base,
      saved: extractDraftRowInput(state(savedOverrides)),
      record: rec,
      accounts: ACCOUNTS,
      valid: VALID,
    })

  it('保存した入力を、計算し直した初期値の上に重ねる。利用者の入力は、キーワードルールの推定(初期値)より優先される', () => {
    const { state: restored, dropped } = apply({ counterpartyId: 11, counterAccountId: 1, counterAccountTouched: true, comment: 'メモ', projectId: 20 })

    expect(restored).toMatchObject({ counterpartyId: 11, counterAccountId: 1, counterAccountTouched: true, comment: 'メモ', projectId: 20 })
    expect(dropped).toBe(false)
  })

  it('推定の記録(初期の取引先・取引先の候補)は、保存した入力ではなく、計算し直した初期値のまま', () => {
    const base = state({ counterpartyId: 10, initialCounterpartyId: 10, candidateCounterpartyIds: [10, 11] })

    const { state: restored } = apply({ counterAccountId: 1, counterpartyId: 11 }, record(), base)

    expect(restored.initialCounterpartyId).toBe(10)
    expect(restored.candidateCounterpartyIds).toEqual([10, 11])
  })

  it('保存したあとに削除された相手科目は戻さず、その行の初期値に戻して、戻せなかった行として数える', () => {
    const { state: restored, dropped } = apply({ counterAccountId: 99, counterAccountTouched: true, comment: 'メモ' })

    expect(restored.counterAccountId).toBe(1)
    expect(restored.counterAccountTouched).toBe(false)
    expect(restored.comment).toBe('メモ')
    expect(dropped).toBe(true)
  })

  it('削除された取引先・プロジェクト・世帯メンバー・精算バッチも、戻さずに初期値(なし)に戻して数える', () => {
    for (const overrides of [{ counterpartyId: 99 }, { projectId: 99 }, { householdMemberId: 99 }, { settlementBatchId: 99 }]) {
      const { state: restored, dropped } = apply({ counterAccountId: 1, ...overrides })
      expect(dropped).toBe(true)
      expect(restored.projectId).toBeNull()
      expect(restored.householdMemberId).toBeNull()
      expect(restored.settlementBatchId).toBeNull()
    }
  })

  it('取引先を持てない科目(資産・負債)が相手科目の行は、取引先を戻さない(DDLの制約と同じ)', () => {
    const { state: restored } = apply({ counterAccountId: 2, counterpartyId: 11 })

    expect(restored.counterAccountId).toBe(2)
    expect(restored.counterpartyId).toBeNull()
  })

  it('「置き換える」で削除する登録済みの仕訳が、いまの候補に無ければ戻さない(選び直しにして数える)', () => {
    const rec = record({ approximateCandidates: [{ journalEntryId: 7 }, { journalEntryId: 8 }] })

    const gone = apply({ counterAccountId: 1, approximateDecision: 'confirmed_replacement', replacementTargetId: 99 }, rec)
    const kept = apply({ counterAccountId: 1, approximateDecision: 'confirmed_replacement', replacementTargetId: 8 }, rec)

    expect(gone.state.replacementTargetId).toBeNull()
    expect(gone.dropped).toBe(true)
    expect(kept.state.replacementTargetId).toBe(8)
    expect(kept.dropped).toBe(false)
  })

  it('似た取引が(いまは)無い行には、似た取引の扱いを戻さず、既定のままにする。完全重複でなくなった行の「取り込む」も戻さない', () => {
    const { state: restored } = apply({ counterAccountId: 1, approximateDecision: 'skip', includeDuplicate: true })

    expect(restored.approximateDecision).toBe('different_transaction')
    expect(restored.includeDuplicate).toBe(false)
  })

  it('似た取引・完全重複がある行には、保存した扱いを戻す', () => {
    const rec = record({ isExactDuplicate: true, approximateCandidates: [{ journalEntryId: 7 }] })

    const { state: restored } = apply({ counterAccountId: 1, approximateDecision: 'skip', includeDuplicate: true }, rec)

    expect(restored.approximateDecision).toBe('skip')
    expect(restored.includeDuplicate).toBe(true)
  })

  it('摘要の提案(キーワードの登録)の入力は、そのまま戻し、提案の科目が削除されていれば初期値に戻して数える', () => {
    const ok = apply({ counterAccountId: 1, learnOn: false, learnPattern: 'スーパー', learnAccountTouched: true, learnAccountId: 1 })
    const gone = apply({ counterAccountId: 1, learnAccountTouched: true, learnAccountId: 99 })

    expect(ok.state).toMatchObject({ learnOn: false, learnPattern: 'スーパー', learnAccountTouched: true, learnAccountId: 1 })
    expect(ok.dropped).toBe(false)
    expect(gone.state.learnAccountTouched).toBe(false)
    expect(gone.state.learnAccountId).toBeNull()
    expect(gone.dropped).toBe(true)
  })
})
