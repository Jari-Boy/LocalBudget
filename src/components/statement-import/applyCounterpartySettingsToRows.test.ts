/**
 * applyCounterpartySettingsToRows(「ほかの行にも適用」、計画Issue #207)の単体テスト。
 * 取引先の設定(キーワードの一覧と相手科目の初期値)を、取り込み中のほかの行へ画面上だけで反映する規則を確認する。
 * キーワードを含み取引先が未設定の行にだけ取引先を設定し、別の取引先に自動マッチした行・手で選んだ行・
 * 候補が複数ある曖昧な行・確定済みの行・重複の行は変えない。相手科目は手で選んでいない行にだけ入れる。
 * 反映した行は初期状態も合わせて更新する(未保存警告の誤検知と二重のキーワード登録を避ける)。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { applyCounterpartySettingsToRows, type CounterpartySettings } from './applyCounterpartySettingsToRows'
import { createInitialRowState, isRowEdited, shouldOfferLearn, type ImportRowState } from './importRowModel'

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
const NEWS = account(2, { category: 'expense', name: '新聞購読料' })
const BANK = account(3, { category: 'asset', name: '普通預金', isReconcilable: true })
const ACCOUNTS = [FOOD, NEWS, BANK]

const NEWS_SHOP = 100
const OTHER_SHOP = 200

const record = (overrides: Partial<{ isExactDuplicate: boolean }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

function state(overrides: Partial<ImportRowState> = {}): ImportRowState {
  return { ...createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }), ...overrides }
}

/** 新聞販売店Aのキーワード「新聞販売店A」を持つ設定(相手科目の初期値は指定がなければなし) */
const settingsWith = (defaultAccountId: number | null = null, keywords: string[] = ['新聞販売店A']): CounterpartySettings => ({
  counterpartyId: NEWS_SHOP,
  keywords,
  defaultAccountId,
})

function run(params: {
  rows: ImportRowState[]
  descriptions: string[]
  settings?: CounterpartySettings
  done?: number[]
  records?: unknown[]
  initialRows?: ImportRowState[]
}) {
  return applyCounterpartySettingsToRows({
    states: params.rows,
    initialStates: params.initialRows ?? params.rows,
    records: (params.records ?? params.rows.map(() => record())) as never,
    descriptions: params.descriptions,
    done: new Set(params.done ?? []),
    settings: params.settings ?? settingsWith(),
    accounts: ACCOUNTS,
  })
}

describe('取引先の設定(キーワード)', () => {
  it('キーワードを含み、取引先が未設定で手で触っていない行にだけ取引先を設定し、件数を返す', () => {
    const result = run({
      rows: [state(), state(), state()],
      descriptions: ['新聞販売店A 2月分', '別の店B', '新聞販売店A 1月分'],
    })

    expect(result.states.map((s) => s.counterpartyId)).toEqual([NEWS_SHOP, null, NEWS_SHOP])
    expect(result.applied).toBe(2)
  })

  it('キーワードの照合は正規化(全角半角・大文字小文字・空白)して行う', () => {
    const result = run({ rows: [state()], descriptions: ['ｓｈｉｎｂｕｎ-a 引落'], settings: settingsWith(null, ['SHINBUN-A']) })

    expect(result.states[0].counterpartyId).toBe(NEWS_SHOP)
  })

  it('別の取引先に自動マッチ済みの行・手で別の取引先を選んだ行は変えない', () => {
    const autoMatched = state({ counterpartyId: OTHER_SHOP, initialCounterpartyId: OTHER_SHOP })
    const picked = state({ counterpartyId: OTHER_SHOP, initialCounterpartyId: null })

    const result = run({ rows: [autoMatched, picked], descriptions: ['新聞販売店A', '新聞販売店A'] })

    expect(result.states.map((s) => s.counterpartyId)).toEqual([OTHER_SHOP, OTHER_SHOP])
    expect(result.applied).toBe(0)
  })

  it('取引先の候補が複数ある曖昧な行は、自動確定しないので変えない', () => {
    const ambiguous = state({ candidateCounterpartyIds: [NEWS_SHOP, OTHER_SHOP] })

    const result = run({ rows: [ambiguous], descriptions: ['新聞販売店A'] })

    expect(result.states[0].counterpartyId).toBeNull()
  })

  it('確定済みの行と、取り込み済みで対象外の重複の行は変えない', () => {
    const result = run({
      rows: [state(), state()],
      descriptions: ['新聞販売店A', '新聞販売店A'],
      done: [0],
      records: [record(), record({ isExactDuplicate: true })],
    })

    expect(result.states.map((s) => s.counterpartyId)).toEqual([null, null])
  })

  it('相手科目が費用・収益でない行には、取引先を持てないので設定しない', () => {
    const result = run({ rows: [state({ counterAccountId: BANK.id })], descriptions: ['新聞販売店A'] })

    expect(result.states[0].counterpartyId).toBeNull()
    expect(result.applied).toBe(0)
  })

  it('空のキーワードだけの設定では、どの行にも設定しない', () => {
    expect(run({ rows: [state()], descriptions: ['新聞販売店A'], settings: settingsWith(null, [' ']) }).applied).toBe(0)
  })
})

describe('相手科目の初期値', () => {
  it('同じ取引先を持ち、相手科目を手で選んでいない行にだけ、初期値の科目を設定する', () => {
    const untouched = state({ counterpartyId: NEWS_SHOP, initialCounterpartyId: NEWS_SHOP, counterAccountId: FOOD.id })
    const touched = state({ counterpartyId: NEWS_SHOP, initialCounterpartyId: NEWS_SHOP, counterAccountId: FOOD.id, counterAccountTouched: true })
    const otherShop = state({ counterpartyId: OTHER_SHOP, initialCounterpartyId: OTHER_SHOP, counterAccountId: FOOD.id })

    const result = run({
      rows: [untouched, touched, otherShop],
      descriptions: ['x', 'x', 'x'],
      settings: settingsWith(NEWS.id),
    })

    expect(result.states.map((s) => s.counterAccountId)).toEqual([NEWS.id, FOOD.id, FOOD.id])
    expect(result.applied).toBe(1)
  })

  it('取引先を新しく設定した行にも、初期値の科目が入る。科目は手で選んだ扱いにならない', () => {
    const result = run({ rows: [state()], descriptions: ['新聞販売店A'], settings: settingsWith(NEWS.id) })

    expect(result.states[0]).toMatchObject({ counterpartyId: NEWS_SHOP, counterAccountId: NEWS.id, counterAccountTouched: false })
    expect(result.applied).toBe(1)
  })

  it('取引先が違う行・取引先が未設定のままの行は、初期値の科目を入れない', () => {
    const result = run({ rows: [state({ counterAccountId: FOOD.id })], descriptions: ['別の店B'], settings: settingsWith(NEWS.id) })

    expect(result.states[0].counterAccountId).toBe(FOOD.id)
  })

  it('初期値が未設定の下書きでは、相手科目を変えない', () => {
    const row = state({ counterpartyId: NEWS_SHOP, initialCounterpartyId: NEWS_SHOP, counterAccountId: FOOD.id })

    expect(run({ rows: [row], descriptions: ['x'], settings: settingsWith(null) }).applied).toBe(0)
  })

  it('初期値の科目が費用・収益でない(取引先を持てない)場合は、設定しない', () => {
    const row = state({ counterpartyId: NEWS_SHOP, initialCounterpartyId: NEWS_SHOP, counterAccountId: FOOD.id })

    expect(run({ rows: [row], descriptions: ['x'], settings: settingsWith(BANK.id) }).applied).toBe(0)
  })

  it('すでに初期値と同じ科目の行は、設定した件数に数えない', () => {
    const row = state({ counterpartyId: NEWS_SHOP, initialCounterpartyId: NEWS_SHOP, counterAccountId: NEWS.id })

    expect(run({ rows: [row], descriptions: ['x'], settings: settingsWith(NEWS.id) }).applied).toBe(0)
  })
})

describe('反映した行の初期状態', () => {
  it('反映した行は初期状態も更新し、未保存の編集とは見なされず、パターン登録の候補にもならない', () => {
    const rows = [state()]
    const result = run({ rows, descriptions: ['新聞販売店A'], settings: settingsWith(NEWS.id), initialRows: rows })

    expect(isRowEdited(result.states[0], result.initialStates[0])).toBe(false)
    expect(result.initialStates[0]).toMatchObject({ counterpartyId: NEWS_SHOP, counterAccountId: NEWS.id })
    expect(shouldOfferLearn(record(), result.states[0])).toBe(false)
  })

  it('コメントなど、反映の対象でない項目を手で編集していた行は、その編集を未保存のまま残す', () => {
    const initial = state()
    const edited = { ...initial, comment: '定期購読' }

    const result = run({ rows: [edited], descriptions: ['新聞販売店A'], initialRows: [initial] })

    expect(result.states[0].comment).toBe('定期購読')
    expect(isRowEdited(result.states[0], result.initialStates[0])).toBe(true)
  })

  it('反映しなかった行の状態と初期状態は、そのまま変わらない', () => {
    const rows = [state(), state()]

    const result = run({ rows, descriptions: ['新聞販売店A', '別の店B'] })

    expect(result.states[1]).toBe(rows[1])
    expect(result.initialStates[1]).toBe(rows[1])
  })
})
