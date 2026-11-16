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

const record = (overrides: Partial<{ isExactDuplicate: boolean }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

const state = (overrides: Partial<ImportRowState> = {}): ImportRowState => ({
  ...createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }),
  ...overrides,
})

function run(params: { rows: ImportRowState[]; descriptions: string[]; keywords?: string[]; done?: number[]; records?: unknown[]; initialRows?: ImportRowState[] }) {
  return applyAccountKeywordsToRows({
    states: params.rows,
    initialStates: params.initialRows ?? params.rows,
    records: (params.records ?? params.rows.map(() => record())) as never,
    descriptions: params.descriptions,
    done: new Set(params.done ?? []),
    settings: { accountId: CASH.id, keywords: params.keywords ?? ['ATM'] },
    accounts: ACCOUNTS,
  })
}

describe('applyAccountKeywordsToRows', () => {
  it('キーワードを含み、相手科目が未設定で手で触っていない行に、科目を入れる(手で選んだ扱いにはしない)', () => {
    const result = run({ rows: [state(), state()], descriptions: ['ATM引出 新宿', '別の店'] })

    expect(result.states[0]).toMatchObject({ counterAccountId: CASH.id, counterAccountTouched: false })
    expect(result.states[1].counterAccountId).toBeNull()
    expect(result.applied).toBe(1)
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
