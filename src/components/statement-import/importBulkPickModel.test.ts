/**
 * importBulkPickModel(明細取込の一括編集バーの「選んだ項目」と、その適用。計画Issue #300)のユニットテスト。
 * 項目を「変更しない・外す・この値にする」で持つこと、選択した行(科目を変えるなら変更後の科目)から選べる項目を
 * 先に決めて理由を返すこと(取引先は費用・収益の科目だけ、精算バッチは一時勘定の科目だけ、世帯メンバーは既定メンバーの
 * ない科目だけ)、重複・保存しない行だけを選んでいるときはすべて選べないこと、選べなくなった項目の選択が
 * 「変更しない」に戻ること、適用で「変更しない」以外の項目だけが対象行に反映され対象外の行は変わらないことを検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { createInitialRowState, type ImportRowState } from './importRowModel'
import {
  BULK_CLEAR_VALUE,
  EMPTY_IMPORT_BULK_PICK,
  applyImportBulkPick,
  importBulkRules,
  isImportBulkPickEmpty,
  pickChangeToValue,
  sanitizeImportBulkPick,
  valueToPickChange,
  type ImportBulkPick,
} from './importBulkPickModel'

function account(id: number, overrides: Partial<Account>): Account {
  return {
    id,
    category: 'expense',
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    ...overrides,
  } as Account
}

const FOOD = account(1, { category: 'expense', name: '食費' })
const SALARY = account(2, { category: 'revenue', name: '給与' })
const ADVANCE = account(3, { category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
/** 既定の世帯メンバーを持つ科目(明細側では世帯メンバーを変えられない) */
const CASH = account(4, { category: 'asset', name: '財布', isReconcilable: false, householdMemberId: 9, isSystemManaged: true })
const BANK = account(5, { category: 'asset', name: '普通預金', isReconcilable: true })
const ACCOUNTS = [FOOD, SALARY, ADVANCE, CASH, BANK]

const plainRecord = { isExactDuplicate: false, approximateCandidates: [] } as never
const duplicateRecord = { isExactDuplicate: true, approximateCandidates: [] } as never
/** 似た取引がある行(「保存しない」を選ぶと対象外になる) */
const similarRecord = { isExactDuplicate: false, approximateCandidates: [{ journalEntryId: 1 }] } as never

function state(overrides: Partial<ImportRowState> = {}): ImportRowState {
  return { ...createInitialRowState({ counterpartyId: null, counterAccountId: FOOD.id, candidateCounterpartyIds: [] }), ...overrides }
}

const pick = (overrides: Partial<ImportBulkPick> = {}): ImportBulkPick => ({ ...EMPTY_IMPORT_BULK_PICK, ...overrides })

describe('選択欄の値との変換(pickChangeToValue / valueToPickChange)', () => {
  it('「変更しない」は空文字、「外す」は専用の値、「この値にする」はidの文字列になる', () => {
    expect(pickChangeToValue({ kind: 'keep' })).toBe('')
    expect(pickChangeToValue({ kind: 'clear' })).toBe(BULK_CLEAR_VALUE)
    expect(pickChangeToValue({ kind: 'set', value: 7 })).toBe('7')
  })

  it('選択欄の値から、同じ選び方に戻せる', () => {
    expect(valueToPickChange('')).toEqual({ kind: 'keep' })
    expect(valueToPickChange(BULK_CLEAR_VALUE)).toEqual({ kind: 'clear' })
    expect(valueToPickChange('7')).toEqual({ kind: 'set', value: 7 })
  })
})

describe('isImportBulkPickEmpty', () => {
  it('すべて「変更しない」なら空、どれか1つでも選べば空ではない', () => {
    expect(isImportBulkPickEmpty(EMPTY_IMPORT_BULK_PICK)).toBe(true)
    expect(isImportBulkPickEmpty(pick({ counterAccountId: FOOD.id }))).toBe(false)
    expect(isImportBulkPickEmpty(pick({ project: { kind: 'clear' } }))).toBe(false)
    expect(isImportBulkPickEmpty(pick({ comment: 'メモ' }))).toBe(false)
  })

  it('コメントが空文字なら「変更しない」', () => {
    expect(isImportBulkPickEmpty(pick({ comment: '' }))).toBe(true)
  })
})

describe('importBulkRules', () => {
  const states = [state(), state({ counterAccountId: SALARY.id }), state({ counterAccountId: ADVANCE.id }), state()]
  const records = [plainRecord, plainRecord, plainRecord, duplicateRecord]

  it('費用・収益の行だけを選んでいれば、取引先を選べる。精算バッチ・世帯メンバーの可否は科目で決まる', () => {
    const rules = importBulkRules({ states, records, selected: new Set([0, 1]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.targetCount).toBe(2)
    expect(rules.counterpartyAllowed).toBe(true)
    expect(rules.batchAllowed).toBe(false)
    expect(rules.memberAllowed).toBe(true)
  })

  it('費用・収益でない科目の行を含むと取引先を選べず、理由の科目名を返す', () => {
    const rules = importBulkRules({ states, records, selected: new Set([0, 2]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.counterpartyAllowed).toBe(false)
    expect(rules.counterpartyBlockedBy).toEqual(['立替金'])
  })

  it('精算バッチは、選んだ行がすべて一時勘定(立替金など)のときだけ選べる', () => {
    const onlyAdvance = importBulkRules({ states, records, selected: new Set([2]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(onlyAdvance.batchAllowed).toBe(true)
    const mixed = importBulkRules({ states, records, selected: new Set([0, 2]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(mixed.batchAllowed).toBe(false)
    expect(mixed.batchBlockedBy).toEqual(['食費'])
  })

  it('既定の世帯メンバーを持つ科目の行を含むと、世帯メンバーを選べない', () => {
    const rules = importBulkRules({ states: [state({ counterAccountId: CASH.id })], records: [plainRecord], selected: new Set([0]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.memberAllowed).toBe(false)
    expect(rules.memberBlockedBy).toEqual(['財布'])
  })

  it('相手科目を一括で変えるときは、変更後の科目で判断する', () => {
    const toAdvance = importBulkRules({ states, records, selected: new Set([0, 1]), pick: pick({ counterAccountId: ADVANCE.id }), accounts: ACCOUNTS })
    expect(toAdvance.counterpartyAllowed).toBe(false)
    expect(toAdvance.batchAllowed).toBe(true)
    const toFood = importBulkRules({ states, records, selected: new Set([0, 2]), pick: pick({ counterAccountId: FOOD.id }), accounts: ACCOUNTS })
    expect(toFood.counterpartyAllowed).toBe(true)
  })

  it('相手科目が未選択の行は、取引先を選べる(科目が決まるまで制約を判定できない)', () => {
    const rules = importBulkRules({ states: [state({ counterAccountId: null })], records: [plainRecord], selected: new Set([0]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.counterpartyAllowed).toBe(true)
    expect(rules.batchAllowed).toBe(false)
  })

  it('重複の行は数えず、対象にもしない(重複の行の科目で選べる項目は決まらない)', () => {
    const rules = importBulkRules({ states, records, selected: new Set([0, 3]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.targetCount).toBe(1)
    expect(rules.skippedCount).toBe(1)
  })

  it('重複・保存しない行だけを選んでいるときは、対象が0行で、どの項目も選べない', () => {
    const rules = importBulkRules({
      states: [state(), state({ approximateDecision: 'skip' })],
      records: [duplicateRecord, similarRecord],
      selected: new Set([0, 1]),
      pick: EMPTY_IMPORT_BULK_PICK,
      accounts: ACCOUNTS,
    })
    expect(rules.targetCount).toBe(0)
    expect(rules.skippedCount).toBe(2)
    expect(rules.accountAllowed).toBe(false)
    expect(rules.projectAllowed).toBe(false)
    expect(rules.counterpartyAllowed).toBe(false)
    expect(rules.batchAllowed).toBe(false)
    expect(rules.memberAllowed).toBe(false)
    expect(rules.commentAllowed).toBe(false)
  })

  it('対象の行があれば、科目・プロジェクト・コメントは常に選べる', () => {
    const rules = importBulkRules({ states, records, selected: new Set([2]), pick: EMPTY_IMPORT_BULK_PICK, accounts: ACCOUNTS })
    expect(rules.accountAllowed).toBe(true)
    expect(rules.projectAllowed).toBe(true)
    expect(rules.commentAllowed).toBe(true)
  })
})

describe('sanitizeImportBulkPick', () => {
  it('選べなくなった項目の選択を「変更しない」に戻し、選べる項目と科目・プロジェクト・コメントは残す', () => {
    const rules = {
      targetCount: 1,
      skippedCount: 0,
      accountAllowed: true,
      projectAllowed: true,
      commentAllowed: true,
      counterpartyAllowed: false,
      batchAllowed: false,
      memberAllowed: true,
      counterpartyBlockedBy: [],
      batchBlockedBy: [],
      memberBlockedBy: [],
    }
    const result = sanitizeImportBulkPick(
      pick({
        counterAccountId: FOOD.id,
        project: { kind: 'set', value: 7 },
        counterparty: { kind: 'set', value: 3 },
        batch: { kind: 'clear' },
        member: { kind: 'set', value: 2 },
        comment: 'メモ',
      }),
      rules,
    )
    expect(result).toEqual(
      pick({
        counterAccountId: FOOD.id,
        project: { kind: 'set', value: 7 },
        member: { kind: 'set', value: 2 },
        comment: 'メモ',
      }),
    )
  })
})

describe('applyImportBulkPick', () => {
  const records = [plainRecord, plainRecord, duplicateRecord, plainRecord]
  const states = [state(), state({ counterAccountId: SALARY.id }), state(), state({ counterAccountId: ADVANCE.id })]

  it('「変更しない」以外の項目だけを、選択した対象行に反映する', () => {
    const result = applyImportBulkPick({
      states,
      records,
      selected: new Set([0, 1]),
      accounts: ACCOUNTS,
      pick: pick({ project: { kind: 'set', value: 7 }, comment: 'メモ' }),
    })
    expect(result.states[0]).toMatchObject({ projectId: 7, comment: 'メモ', counterAccountId: FOOD.id })
    expect(result.states[1]).toMatchObject({ projectId: 7, comment: 'メモ', counterAccountId: SALARY.id })
    expect(result.states[3]).toBe(states[3])
    expect(result.applied).toBe(2)
    expect(result.skipped).toBe(0)
  })

  it('「外す」を選んだ項目は、対象行でnullにする', () => {
    const withProject = [state({ projectId: 7, householdMemberId: 2 })]
    const result = applyImportBulkPick({
      states: withProject,
      records: [plainRecord],
      selected: new Set([0]),
      accounts: ACCOUNTS,
      pick: pick({ project: { kind: 'clear' }, member: { kind: 'clear' } }),
    })
    expect(result.states[0]).toMatchObject({ projectId: null, householdMemberId: null })
  })

  it('重複の行は変えず、スキップした行数に数える', () => {
    const result = applyImportBulkPick({
      states,
      records,
      selected: new Set([0, 2]),
      accounts: ACCOUNTS,
      pick: pick({ project: { kind: 'set', value: 7 } }),
    })
    expect(result.states[2]).toBe(states[2])
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('相手科目と取引先を同時に選ぶと、相手科目を先に反映してから取引先を反映する(科目の制約に合わせる)', () => {
    const result = applyImportBulkPick({
      states: [state({ counterAccountId: ADVANCE.id })],
      records: [plainRecord],
      selected: new Set([0]),
      accounts: ACCOUNTS,
      pick: pick({ counterAccountId: FOOD.id, counterparty: { kind: 'set', value: 3 } }),
    })
    expect(result.states[0]).toMatchObject({ counterAccountId: FOOD.id, counterpartyId: 3 })
  })

  it('相手科目を取引先を持てない科目に変えると、その行の取引先は外れる(行ごとの変更と同じ整合)', () => {
    const result = applyImportBulkPick({
      states: [state({ counterpartyId: 5 })],
      records: [plainRecord],
      selected: new Set([0]),
      accounts: ACCOUNTS,
      pick: pick({ counterAccountId: BANK.id }),
    })
    expect(result.states[0]).toMatchObject({ counterAccountId: BANK.id, counterpartyId: null })
  })

  it('何も選んでいないときは、状態を変えず0行を返す', () => {
    const result = applyImportBulkPick({ states, records, selected: new Set([0, 1]), accounts: ACCOUNTS, pick: EMPTY_IMPORT_BULK_PICK })
    expect(result.states).toEqual(states)
    expect(result.applied).toBe(0)
  })
})
