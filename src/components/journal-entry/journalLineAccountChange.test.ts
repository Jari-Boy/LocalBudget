/**
 * 明細行の科目を変えたときの行の更新(applyAccountChange、計画Issue #182で JournalLinesEditor から切り出し)の
 * ユニットテスト。詳細パネルの行編集と、明細行単位の表のインライン編集が同じ規則を使うことを保証する。
 * 取引先は費用・収益の科目でだけ保つ、精算バッチはシステム管理の立替金・未払金でだけ保つ、
 * 世帯メンバーは科目の既定メンバー > 手で選んだ値 > 起票者の順で決まる、を検証する。
 * 外部依存なし(DB・DOMに触れない)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import { applyAccountChange } from './journalLineAccountChange'
import type { JournalEntryFormLine } from './journalEntryFormLine'

function account(id: number, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

const expense = account(1, 'expense')
const asset = account(2, 'asset')
const advance = account(3, 'asset', { isSystemManaged: true })
const hanakoExpense = account(4, 'expense', { householdMemberId: 2 })
const accountById = new Map([expense, asset, advance, hanakoExpense].map((a) => [a.id, a]))

const base: JournalEntryFormLine = {
  accountId: 1,
  side: 'debit',
  amountInput: '1000',
  projectId: 5,
  householdMemberId: 1,
  counterpartyId: 9,
  settlementBatchId: 7,
}

const change = (line: JournalEntryFormLine, accountId: number | null, bookkeeperId: number | null = 1) =>
  applyAccountChange({ line, accountId, accountById, bookkeeperId })

describe('applyAccountChange', () => {
  it('費用・収益の科目に変えたときは、取引先を保つ', () => {
    expect(change({ ...base, accountId: 2 }, 1).counterpartyId).toBe(9)
  })

  it('資産などの科目に変えたときは、取引先を外す', () => {
    expect(change(base, 2).counterpartyId).toBeNull()
  })

  it('システム管理の立替金・未払金に変えたときは、精算バッチを保つ', () => {
    expect(change(base, 3).settlementBatchId).toBe(7)
  })

  it('それ以外の科目に変えたときは、精算バッチを外す', () => {
    expect(change(base, 1).settlementBatchId).toBeNull()
  })

  it('科目の選択を外したとき(null)は、科目・取引先・精算バッチが空になる', () => {
    const result = change(base, null)
    expect(result.accountId).toBeNull()
    expect(result.counterpartyId).toBeNull()
    expect(result.settlementBatchId).toBeNull()
  })

  it('既定の世帯メンバーがある科目に変えたときは、その既定メンバーになる', () => {
    expect(change(base, 4).householdMemberId).toBe(2)
  })

  it('既定メンバーのある科目から、ない科目に変えたときは、起票者に戻る', () => {
    expect(change({ ...base, accountId: 4, householdMemberId: 2 }, 1, 1).householdMemberId).toBe(1)
  })

  it('既定メンバーのない科目の間は、手で選んだメンバーを保つ', () => {
    expect(change({ ...base, householdMemberId: 2 }, 2, 1).householdMemberId).toBe(2)
  })

  it('金額・プロジェクト・貸借など、科目に関係しない項目は変わらない', () => {
    const result = change(base, 2)
    expect(result.amountInput).toBe('1000')
    expect(result.projectId).toBe(5)
    expect(result.side).toBe('debit')
  })
})
