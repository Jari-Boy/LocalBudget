/**
 * importRowModel(明細取込画面の1行ごとの入力状態、計画Issue #151)のユニットテスト。
 * 行の状態(新規・重複・要確認)の判定、選択した行への一括設定(対象外の行の件数を返す。取引先は
 * 費用・収益の行だけ、精算バッチは一時勘定の行だけ、既定の世帯メンバーを持つ科目の行は世帯メンバーを
 * 変えない)、パターン登録の提案と有効性(摘要に含まれる文字列だけ登録できる)を検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import {
  applyBulkSetting,
  createInitialRowState,
  isLearnPatternValid,
  rowStatus,
  shouldOfferLearn,
  type ImportRowState,
} from './importRowModel'

function account(id: number, overrides: Partial<Account>): Account {
  return {
    id,
    category: 'expense',
    name: `科目${id}`,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    ...overrides,
  } as Account
}

const FOOD = account(1, { category: 'expense', name: '食費' })
const SALARY = account(2, { category: 'revenue', name: '給与' })
const ADVANCE = account(3, { category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
/** 利用者が作った、照合しない資産(有価証券など)。精算バッチは付けられない */
const SECURITIES = account(6, { category: 'asset', name: '有価証券', isReconcilable: false })
const CASH = account(4, { category: 'asset', name: '財布', isReconcilable: false, householdMemberId: 9, isSystemManaged: true })
const BANK = account(5, { category: 'asset', name: '普通預金', isReconcilable: true })
const ACCOUNTS = [FOOD, SALARY, ADVANCE, CASH, BANK, SECURITIES]

const record = (overrides: Partial<{ isExactDuplicate: boolean; approximateCandidates: unknown[] }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

function state(overrides: Partial<ImportRowState> = {}): ImportRowState {
  return { ...createInitialRowState({ counterpartyId: null, counterAccountId: FOOD.id, candidateCounterpartyIds: [] }), ...overrides }
}

describe('rowStatus', () => {
  it('取り込み済みと完全一致する行は「重複」、「取り込む」を選ぶと「新規」に戻る', () => {
    expect(rowStatus(record({ isExactDuplicate: true }), state())).toBe('duplicate')
    expect(rowStatus(record({ isExactDuplicate: true }), state({ includeDuplicate: true }))).toBe('new')
  })

  it('確定版の可能性の候補があり未判断の行、相手科目が未選択の行は「要確認」', () => {
    expect(rowStatus(record({ approximateCandidates: [{}] }), state())).toBe('check')
    expect(rowStatus(record({ approximateCandidates: [{}] }), state({ approximateDecision: 'different_transaction' }))).toBe('new')
    expect(rowStatus(record(), state({ counterAccountId: null }))).toBe('check')
  })

  it('それ以外は「新規」', () => {
    expect(rowStatus(record(), state())).toBe('new')
  })
})

describe('applyBulkSetting', () => {
  const rows = [record(), record(), record({ isExactDuplicate: true })]

  it('選択した行の相手科目を変えると、非費用収益の科目では取引先を外し、一時勘定以外では精算バッチを外す', () => {
    const states = [state({ counterpartyId: 5, settlementBatchId: 7 }), state(), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0]), accounts: ACCOUNTS, change: { field: 'counterAccount', value: BANK.id } })

    expect(result.states[0]).toMatchObject({ counterAccountId: BANK.id, counterpartyId: null, settlementBatchId: null, counterAccountTouched: true })
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('取引先は費用・収益の行にだけ設定し、立替金などの行は対象外の件数に数える', () => {
    const states = [state(), state({ counterAccountId: ADVANCE.id }), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'counterparty', value: 5 } })

    expect(result.states[0].counterpartyId).toBe(5)
    expect(result.states[1].counterpartyId).toBeNull()
    expect(result).toMatchObject({ applied: 1, skipped: 1 })
  })

  it('精算バッチは立替金・未払金(一時勘定)の行にだけ設定する', () => {
    const states = [state(), state({ counterAccountId: ADVANCE.id }), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'settlementBatch', value: 3 } })

    expect(result.states[0].settlementBatchId).toBeNull()
    expect(result.states[1].settlementBatchId).toBe(3)
    expect(result).toMatchObject({ applied: 1, skipped: 1 })
  })

  it('精算バッチは、利用者が作った照合しない資産(有価証券など)の行には設定しない', () => {
    const states = [state({ counterAccountId: SECURITIES.id }), state(), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0]), accounts: ACCOUNTS, change: { field: 'settlementBatch', value: 3 } })

    expect(result.states[0].settlementBatchId).toBeNull()
    expect(result).toMatchObject({ applied: 0, skipped: 1 })
  })

  it('世帯メンバーは、科目に既定の世帯メンバーがある行(変更できない行)には設定しない', () => {
    const states = [state(), state({ counterAccountId: CASH.id }), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'householdMember', value: 2 } })

    expect(result.states[0].householdMemberId).toBe(2)
    expect(result.states[1].householdMemberId).toBeNull()
    expect(result).toMatchObject({ applied: 1, skipped: 1 })
  })

  it('プロジェクトとコメントはすべての選択行に設定する。値をnull・空文字にすればクリアできる', () => {
    const states = [state({ projectId: 4 }), state(), state()]

    const cleared = applyBulkSetting({ states, records: rows, selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'project', value: null } })
    const commented = applyBulkSetting({ states, records: rows, selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'comment', value: '旅行' } })

    expect(cleared.states[0].projectId).toBeNull()
    expect(commented.states.slice(0, 2).map((s) => s.comment)).toEqual(['旅行', '旅行'])
    expect(commented.applied).toBe(2)
  })

  it('重複(対象外)の行は選択されていても変更せず、対象外の件数に数える', () => {
    const states = [state(), state(), state()]

    const result = applyBulkSetting({ states, records: rows, selected: new Set([0, 2]), accounts: ACCOUNTS, change: { field: 'comment', value: 'x' } })

    expect(result.states[2].comment).toBe('')
    expect(result).toMatchObject({ applied: 1, skipped: 1 })
  })
})

describe('パターン登録の提案', () => {
  it('推定と違う取引先を選んだ行(推定が無かった行を含む)だけ提案し、重複の行や取引先なしの行には出さない', () => {
    expect(shouldOfferLearn(record(), state({ counterpartyId: 5, initialCounterpartyId: null }))).toBe(true)
    expect(shouldOfferLearn(record(), state({ counterpartyId: 5, initialCounterpartyId: 5 }))).toBe(false)
    expect(shouldOfferLearn(record(), state({ counterpartyId: null }))).toBe(false)
    expect(shouldOfferLearn(record({ isExactDuplicate: true }), state({ counterpartyId: 5 }))).toBe(false)
  })

  it('登録する文字列は、正規化した摘要に含まれるときだけ有効', () => {
    expect(isLearnPatternValid('セブン', 'セブンイレブン 新宿店')).toBe(true)
    expect(isLearnPatternValid('ｾﾌﾞﾝ', 'セブンイレブン')).toBe(true)
    expect(isLearnPatternValid('ローソン', 'セブンイレブン')).toBe(false)
    expect(isLearnPatternValid('  ', 'セブンイレブン')).toBe(false)
  })

  it('取引先の候補が複数あって決まらなかった行は、パターン登録を既定でオフにする', () => {
    expect(createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [1, 2] }).learnOn).toBe(false)
    expect(createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }).learnOn).toBe(true)
  })
})
