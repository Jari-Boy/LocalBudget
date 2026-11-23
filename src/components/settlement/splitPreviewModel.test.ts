/**
 * splitPreviewModel(割勘仕訳のプレビューの組み立て、計画Issue #271)の純粋関数のユニットテスト。
 * 分担相手ごとに仕訳1件分のプレビューを作ること、付け替えの行を借方・貸方に対応づけること、
 * 立替金・未払金を純額の行にすること、貸借の合計が一致することを検証する(仕訳の組み立ては
 * buildLineExpenseSplittingJournalEntryInputと同じ)。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { buildSplitPreviews } from './splitPreviewModel'

const FOOD = 1
const INCOME = 2
const CASH = 3
const ASSET = 4
const LIABILITY = 5

function account(id: number, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const ACCOUNTS = [
  account(FOOD, 'expense'),
  account(INCOME, 'revenue'),
  account(CASH, 'asset'),
  account(ASSET, 'asset', true),
  account(LIABILITY, 'liability', true),
]

function line(id: number, accountId: number, side: 'debit' | 'credit', amount: number): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
  }
}

const ENTRY = {
  id: 1,
  entryDate: '2026-11-01',
  memo: 'スーパー',
  comment: null,
  currency: 'JPY',
  sourceType: 'manual',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [],
} satisfies JournalEntry

const food = { entry: ENTRY, line: line(10, FOOD, 'debit', 2400) }
const income = { entry: ENTRY, line: line(11, INCOME, 'credit', 500) }

const member = { key: 1, kind: 'householdMember' as const, targetId: 2, ratioInput: '50', amountInput: '' }

const accountName = (id: number) => ({ [FOOD]: '食費', [INCOME]: '雑収入', [ASSET]: '未収金', [LIABILITY]: '未払金' })[id] ?? ''
const memberName = (id: number) => ({ 1: '太郎', 2: '花子' })[id] ?? ''
const counterpartyName = (id: number) => (id === 9 ? '友人' : '')

const common = {
  accounts: ACCOUNTS,
  allocationMode: 'ratio' as const,
  today: '2026-11-23',
  batchLabel: '2行の割勘',
  accountName,
  memberName,
  counterpartyName,
}

describe('buildSplitPreviews', () => {
  it('世帯メンバー1人への割勘を、付け替えの行・立替金と未払金の純額の行に分けて返し、貸借を一致させる', () => {
    const [preview] = buildSplitPreviews({ ...common, selectedLines: [food, income], participants: [member] })
    expect(preview.partnerName).toBe('花子')
    expect(preview.rows.map((r) => [r.debit?.accountName ?? null, r.debit?.amount ?? null, r.credit?.accountName ?? null, r.credit?.amount ?? null])).toEqual([
      ['食費', 1200, '食費', 1200],
      ['雑収入', 250, '雑収入', 250],
      ['未収金', 950, '未払金', 950],
    ])
    expect(preview.debitTotal).toBe(2400)
    expect(preview.creditTotal).toBe(2400)
  })

  it('立替金・未払金の行には精算バッチ名を出す(元の行の列は持たない)', () => {
    const [preview] = buildSplitPreviews({ ...common, selectedLines: [food, income], participants: [member] })
    expect(preview.rows[2].debit?.partner).toBe('2行の割勘')
    expect(preview.rows[2].credit?.partner).toBe('2行の割勘')
    expect(Object.keys(preview.rows[0])).toEqual(['debit', 'credit'])
  })

  it('世帯外の相手には、取引先付きの費用・収益の行と立替金の行を返す', () => {
    const [preview] = buildSplitPreviews({
      ...common,
      selectedLines: [food],
      participants: [{ key: 1, kind: 'counterparty', targetId: 9, ratioInput: '50', amountInput: '' }],
    })
    expect(preview.partnerName).toBe('友人')
    expect(preview.rows.map((r) => [r.debit?.accountName ?? null, r.credit?.accountName ?? null])).toEqual([
      [null, '食費'],
      ['未収金', null],
    ])
    expect(preview.rows[0].credit?.partner).toBe('友人')
  })

  it('分担相手が2人なら2件のプレビューを返す', () => {
    const previews = buildSplitPreviews({
      ...common,
      selectedLines: [food],
      participants: [member, { key: 2, kind: 'counterparty', targetId: 9, ratioInput: '20', amountInput: '' }],
    })
    expect(previews).toHaveLength(2)
  })

  it('計算できない入力(行を選んでいない・負担額が0)のときは空を返す', () => {
    expect(buildSplitPreviews({ ...common, selectedLines: [], participants: [member] })).toEqual([])
    expect(buildSplitPreviews({ ...common, selectedLines: [food], participants: [{ ...member, ratioInput: '0' }] })).toEqual([])
  })
})
