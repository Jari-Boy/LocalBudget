/**
 * importRowModel(明細取込画面の1行ごとの入力状態、計画Issue #151)のユニットテスト。
 * 行の状態(新規・重複・要確認)の判定、選択した行への一括設定(対象外の行の件数を返す。取引先は
 * 費用・収益の行だけ、精算バッチは一時勘定の行だけ、既定の世帯メンバーを持つ科目の行は世帯メンバーを
 * 変えない)、似た取引がある行の選び方(追加する・置き換える・保存しない)と、一覧の3グループ(重複・似た取引あり・
 * 問題なし)への分類、摘要の自動学習をしないこと(計画Issue #259)を検証する。
 * 初期状態からの編集の有無(isRowEdited、計画Issue #193)と、離脱時の未保存警告を出すかの判定(hasUnsavedRows、
 * 編集の有無を問わず、取り込める行が確定も一時保存もされずに残っているか。計画Issue #293)も検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import {
  applyBulkSetting,
  createInitialRowState,
  hasUnsavedRows,
  isRowEdited,
  replacementTargetOf,
  rowGroup,
  rowStatus,
  type ImportRowState,
} from './importRowModel'

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

  it('似た取引がある行は、既定の「別の取引なので追加する」では「新規」で、確定を止めない', () => {
    expect(state().approximateDecision).toBe('different_transaction')
    expect(rowStatus(record({ approximateCandidates: [{ journalEntryId: 1 }] }), state())).toBe('new')
  })

  it('「この取引を保存しない」を選んだ行は「保存しない」になり、相手科目が未選択でも要確認にならない', () => {
    const similar = record({ approximateCandidates: [{ journalEntryId: 1 }] })

    expect(rowStatus(similar, state({ approximateDecision: 'skip' }))).toBe('skipped')
    expect(rowStatus(similar, state({ approximateDecision: 'skip', counterAccountId: null }))).toBe('skipped')
  })

  it('候補が複数あるのに「置き換える」の削除先を選んでいない行は「要確認」、1件なら選ばなくても「新規」', () => {
    const many = record({ approximateCandidates: [{ journalEntryId: 1 }, { journalEntryId: 2 }] })
    const one = record({ approximateCandidates: [{ journalEntryId: 1 }] })

    expect(rowStatus(many, state({ approximateDecision: 'confirmed_replacement' }))).toBe('check')
    expect(rowStatus(many, state({ approximateDecision: 'confirmed_replacement', replacementTargetId: 2 }))).toBe('new')
    expect(rowStatus(one, state({ approximateDecision: 'confirmed_replacement' }))).toBe('new')
  })

  it('相手科目が未選択の行は「要確認」', () => {
    expect(rowStatus(record(), state({ counterAccountId: null }))).toBe('check')
  })

  it('それ以外は「新規」', () => {
    expect(rowStatus(record(), state())).toBe('new')
  })
})

describe('replacementTargetOf(置き換えで削除する登録済みの仕訳)', () => {
  const many = record({ approximateCandidates: [{ journalEntryId: 1 }, { journalEntryId: 2 }] })
  const one = record({ approximateCandidates: [{ journalEntryId: 5 }] })

  it('「置き換える」以外を選んでいる行は、何も削除しない(null)', () => {
    expect(replacementTargetOf(one, state())).toBeNull()
    expect(replacementTargetOf(one, state({ approximateDecision: 'skip' }))).toBeNull()
  })

  it('候補が1件なら、選ばなくてもその1件。複数なら、選んだ1件だけ(未選択はnull)', () => {
    expect(replacementTargetOf(one, state({ approximateDecision: 'confirmed_replacement' }))).toBe(5)
    expect(replacementTargetOf(many, state({ approximateDecision: 'confirmed_replacement' }))).toBeNull()
    expect(replacementTargetOf(many, state({ approximateDecision: 'confirmed_replacement', replacementTargetId: 2 }))).toBe(2)
  })

  it('選んだ削除先が、いまの候補に無いとき(候補が変わった後など)はnull', () => {
    expect(replacementTargetOf(many, state({ approximateDecision: 'confirmed_replacement', replacementTargetId: 99 }))).toBeNull()
  })
})

describe('rowGroup(一覧の3グループ)', () => {
  it('取り込み済みと完全一致する行は「重複」、似た取引がある行は「似た取引あり」、それ以外は「問題なし」', () => {
    expect(rowGroup(record({ isExactDuplicate: true }))).toBe('duplicate')
    expect(rowGroup(record({ approximateCandidates: [{ journalEntryId: 1 }] }))).toBe('similar')
    expect(rowGroup(record())).toBe('clean')
  })

  it('分類は取り込んだときの内容で決まり、「取り込む」を選んでも重複のグループのまま動かない', () => {
    expect(rowGroup(record({ isExactDuplicate: true }))).toBe('duplicate')
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

  it('「この取引を保存しない」を選んだ行には一括設定を掛けず、対象外の件数に数える', () => {
    const similar = record({ approximateCandidates: [{ journalEntryId: 1 }] })
    const states = [state({ approximateDecision: 'skip' }), state()]

    const result = applyBulkSetting({ states, records: [similar, rows[1]], selected: new Set([0, 1]), accounts: ACCOUNTS, change: { field: 'comment', value: 'メモ' } })

    expect(result.states[0].comment).toBe('')
    expect(result.states[1].comment).toBe('メモ')
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

describe('摘要の自動学習の廃止(計画Issue #259)', () => {
  it('行の状態は、摘要をキーワードとして提案・登録するための項目(learn系)を持たない', () => {
    const initial = createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] })

    expect(Object.keys(initial).filter((key) => key.startsWith('learn'))).toEqual([])
  })
})

describe('相手科目の候補(曖昧な行。計画Issue #260)', () => {
  it('候補を渡さなければ、取引先・相手科目の候補は空', () => {
    const initial = createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] })

    expect(initial.candidateAccountIds).toEqual([])
  })

  it('相手科目の候補を渡せば、行の状態に持つ', () => {
    const initial = createInitialRowState({
      counterpartyId: null,
      counterAccountId: null,
      candidateCounterpartyIds: [1],
      candidateAccountIds: [2, 3],
    })

    expect(initial.candidateAccountIds).toEqual([2, 3])
  })

  it('候補は推定の記録なので、変えても編集とはみなさない', () => {
    const initial = createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] })

    expect(isRowEdited({ ...initial, candidateAccountIds: [9] }, initial)).toBe(false)
  })
})

describe('isRowEdited', () => {
  const initial = createInitialRowState({ counterpartyId: 1, counterAccountId: 2, candidateCounterpartyIds: [] })

  it('初期状態のままなら、編集していないとみなす', () => {
    expect(isRowEdited({ ...initial }, initial)).toBe(false)
  })

  it('相手科目・取引先・プロジェクト・世帯メンバー・精算バッチ・コメントのどれかを変えたら、編集したとみなす', () => {
    const changes: Array<Partial<ImportRowState>> = [
      { counterAccountId: 3 },
      { counterpartyId: null },
      { projectId: 5 },
      { householdMemberId: 6 },
      { settlementBatchId: 7 },
      { comment: 'メモ' },
    ]
    for (const change of changes) expect(isRowEdited({ ...initial, ...change }, initial)).toBe(true)
  })

  it('重複を取り込む・確定版の判断を変えたら、編集したとみなす', () => {
    const changes: Array<Partial<ImportRowState>> = [
      { includeDuplicate: true },
      { approximateDecision: 'confirmed_replacement' },
      { approximateDecision: 'skip' },
      { replacementTargetId: 3 },
    ]
    for (const change of changes) expect(isRowEdited({ ...initial, ...change }, initial)).toBe(true)
  })

  it('入力の記録(相手科目を手で選んだか)だけが違っても、値が同じなら編集とみなさない', () => {
    expect(isRowEdited({ ...initial, counterAccountTouched: true }, initial)).toBe(false)
  })
})

describe('hasUnsavedRows(離脱時の未保存警告の判定、計画Issue #293)', () => {
  const initial = createInitialRowState({ counterpartyId: null, counterAccountId: 2, candidateCounterpartyIds: [] })
  const clean = { externalId: 'a', isExactDuplicate: false, approximateCandidates: [] }
  const duplicate = { externalId: 'b', isExactDuplicate: true, approximateCandidates: [] }
  const similar = {
    externalId: 'c',
    isExactDuplicate: false,
    approximateCandidates: [{ journalEntryId: 1 }],
  } as unknown as typeof clean
  const run = (
    records: Array<typeof clean>,
    rows: ImportRowState[],
    options: { done?: number[]; saved?: Array<[string, ImportRowState]> } = {},
  ) => hasUnsavedRows({ records, rows, done: new Set(options.done ?? []), savedStates: new Map(options.saved ?? []) })

  it('未編集でも、取り込める行が確定も一時保存もされず残っていれば、未保存とみなす', () => {
    expect(run([clean], [initial])).toBe(true)
  })

  it('重複(取り込まない)の行だけなら、失うものが無いので未保存とみなさない', () => {
    expect(run([duplicate], [initial])).toBe(false)
  })

  it('「取り込まない」を選んだ行だけなら、未保存とみなさない', () => {
    expect(run([similar], [{ ...initial, approximateDecision: 'skip' }])).toBe(false)
  })

  it('重複の行を「取り込む」にしたら、取り込める行なので未保存とみなす', () => {
    expect(run([duplicate], [{ ...initial, includeDuplicate: true }])).toBe(true)
  })

  it('確定済みの行は対象外で、一部だけ確定して残りが未保存なら未保存とみなす', () => {
    expect(run([clean], [initial], { done: [0] })).toBe(false)
    expect(run([clean, { ...clean, externalId: 'x' }], [initial, initial], { done: [0] })).toBe(true)
  })

  it('取り込める行をすべて一時保存した状態と同じなら、未保存とみなさない', () => {
    expect(run([clean], [initial], { saved: [['a', initial]] })).toBe(false)
  })

  it('一時保存したあとに行を変えて保存した状態と異なれば、未保存とみなす', () => {
    expect(run([clean], [{ ...initial, comment: 'メモ' }], { saved: [['a', initial]] })).toBe(true)
  })

  it('行が1つも無ければ、未保存とみなさない', () => {
    expect(run([], [])).toBe(false)
  })
})
