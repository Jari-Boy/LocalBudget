/**
 * applyAccountKeywordsToRows(資産・負債の科目の「キーワードの設定」の「ほかの行にも適用」、計画Issue #219)の単体テスト。
 * 科目のキーワードを含み、取引先が無く、相手科目が未設定で手で触っていない行にだけ、その科目を入れる。
 * 相手科目を手で選んだ行・別の科目が推定された行・取引先がある行・確定済みの行・重複の行は変えない。
 * 反映した行は初期状態も合わせて更新する(未保存警告の誤検知を避ける)。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { applyAccountKeywordsToRows } from './applyAccountKeywordsToRows'
import { createInitialRowState, isRowEdited, type ImportRowState } from './importRowModel'

const account = (id: number, overrides: Partial<Account>): Account =>
  ({ id, category: 'asset', name: `科目${id}`, isReconcilable: false, hasExternalStatement: null, isActive: true, isSystemManaged: false, autoBalanceAdjustment: true, householdMemberId: null, ...overrides }) as Account

const CASH = account(1, { name: '現金' })
const FOOD = account(2, { category: 'expense', name: '食費', isReconcilable: null })
const ACCOUNTS = [CASH, FOOD]

const record = (overrides: Partial<{ isExactDuplicate: boolean; approximateCandidates: unknown[] }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

const state = (overrides: Partial<ImportRowState> = {}): ImportRowState => ({
  ...createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }),
  ...overrides,
})

function run(params: { rows: ImportRowState[]; descriptions: string[]; keywords?: string[]; done?: number[]; records?: unknown[]; initialRows?: ImportRowState[]; overwrite?: boolean; excludeIndex?: number }) {
  return applyAccountKeywordsToRows({
    states: params.rows,
    initialStates: params.initialRows ?? params.rows,
    records: (params.records ?? params.rows.map(() => record())) as never,
    descriptions: params.descriptions,
    done: new Set(params.done ?? []),
    settings: { accountId: CASH.id, keywords: params.keywords ?? ['ATM'] },
    accounts: ACCOUNTS,
    overwrite: params.overwrite,
    excludeIndex: params.excludeIndex,
  })
}

describe('applyAccountKeywordsToRows', () => {
  it('キーワードを含み、相手科目が未設定で手で触っていない行に、科目を入れる(手で選んだ扱いにはしない)', () => {
    const result = run({ rows: [state(), state()], descriptions: ['ATM引出 新宿', '別の店'] })

    expect(result.states[0]).toMatchObject({ counterAccountId: CASH.id, counterAccountTouched: false })
    expect(result.states[1].counterAccountId).toBeNull()
    expect(result.applied).toBe(1)
  })

  it('取引先・相手科目の候補が残っている曖昧な行は、自動確定しないので変えない(計画Issue #260)', () => {
    const accountCandidates = state({ candidateAccountIds: [CASH.id, FOOD.id] })
    const counterpartyCandidates = state({ candidateCounterpartyIds: [7] })

    const result = run({ rows: [accountCandidates, counterpartyCandidates], descriptions: ['ATM引出', 'ATM引出'] })

    expect(result.states.map((s) => s.counterAccountId)).toEqual([null, null])
    expect(result.applied).toBe(0)
  })

  it('全角半角・大文字小文字・空白を無視してキーワードを照合する', () => {
    const result = run({ rows: [state()], descriptions: ['ａｔｍ 引出'], keywords: ['ATM'] })

    expect(result.applied).toBe(1)
  })

  it('相手科目を手で選んだ行・別の科目が入っている行・取引先がある行は変えない', () => {
    const touched = state({ counterAccountId: FOOD.id, counterAccountTouched: true })
    const estimated = state({ counterAccountId: FOOD.id })
    const withCounterparty = state({ counterpartyId: 7, initialCounterpartyId: 7 })

    const result = run({ rows: [touched, estimated, withCounterparty], descriptions: ['ATM', 'ATM', 'ATM'] })

    expect(result.applied).toBe(0)
  })

  it('確定済みの行と、取り込み済みで対象外の重複の行は変えない', () => {
    const result = run({
      rows: [state(), state()],
      descriptions: ['ATM', 'ATM'],
      done: [0],
      records: [record(), record({ isExactDuplicate: true })],
    })

    expect(result.applied).toBe(0)
  })

  it('「この取引を保存しない」を選んだ行は変えない', () => {
    const similar = record({ approximateCandidates: [{ journalEntryId: 1 }] } as never)
    const result = run({
      rows: [state({ approximateDecision: 'skip' })],
      descriptions: ['ATM'],
      records: [similar],
    })

    expect(result.applied).toBe(0)
  })

  it('空のキーワードは、どの行にも一致しない', () => {
    expect(run({ rows: [state()], descriptions: ['ATM'], keywords: [' '] }).applied).toBe(0)
  })

  it('反映した行は初期状態も更新し、未保存の編集とは見なされない。反映しなかった行は変わらない', () => {
    const rows = [state(), state()]

    const result = run({ rows, descriptions: ['ATM', '別の店'], initialRows: rows })

    expect(isRowEdited(result.states[0], result.initialStates[0])).toBe(false)
    expect(result.initialStates[0].counterAccountId).toBe(CASH.id)
    expect(result.states[1]).toBe(rows[1])
  })
})

describe('applyAccountKeywordsToRows(overwrite: 入力済みの行も上書きする、計画Issue #291)', () => {
  it('相手科目を手で選んだ行・取引先がある行・候補が残る行も、キーワードに一致すれば、科目を上書きする(手で選んだ扱いにはしない)', () => {
    const rows = [
      state({ counterAccountId: FOOD.id, counterAccountTouched: true }),
      state({ counterpartyId: 7, counterAccountId: FOOD.id }),
      state({ candidateAccountIds: [CASH.id, FOOD.id], candidateCounterpartyIds: [7] }),
    ]
    const result = run({ rows, descriptions: ['ATM引出', 'ATM引出', 'ATM引出'], overwrite: true })

    for (const s of result.states) expect(s).toMatchObject({ counterAccountId: CASH.id, counterAccountTouched: false, candidateAccountIds: [], candidateCounterpartyIds: [] })
    // 資産の科目は取引先を持てないので、取引先は外れる
    expect(result.states[1].counterpartyId).toBeNull()
    expect(result.initialStates[0].counterAccountId).toBe(CASH.id)
    expect(result.applied).toBe(3)
  })

  it('キーワードに一致しない行・確定済みの行・重複の行は変えない', () => {
    const rows = [state({ counterAccountId: FOOD.id }), state({ counterAccountId: FOOD.id }), state({ counterAccountId: FOOD.id })]
    const result = run({
      rows,
      descriptions: ['別の店', 'ATM引出', 'ATM引出'],
      done: [1],
      records: [record(), record(), record({ isExactDuplicate: true })],
      overwrite: true,
    })

    expect(result.states).toEqual(rows)
    expect(result.applied).toBe(0)
  })

  it('すでに同じ科目の行は、変わらないので件数に数えない', () => {
    const result = run({ rows: [state({ counterAccountId: CASH.id })], descriptions: ['ATM引出'], overwrite: true })

    expect(result.applied).toBe(0)
  })

  it('excludeIndexで指定した行(キーワードのポップアップを開いた行)は、一致しても上書きしない', () => {
    const rows = [state({ counterAccountId: FOOD.id }), state({ counterAccountId: FOOD.id })]
    const result = run({ rows, descriptions: ['ATM引出', 'ATM引出'], overwrite: true, excludeIndex: 0 })

    expect(result.states[0]).toBe(rows[0])
    expect(result.states[1].counterAccountId).toBe(CASH.id)
    expect(result.applied).toBe(1)
  })
})
