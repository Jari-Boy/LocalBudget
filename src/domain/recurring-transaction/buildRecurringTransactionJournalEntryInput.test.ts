/**
 * buildRecurringTransactionJournalEntryInput(定期仕訳ルールからのCreateJournalEntryInput組み立て)
 * の純粋関数としてのユニットテスト。ルールの行(2行でも3行以上でも同じ扱い、計画Issue #180)を
 * 仕訳の明細行に写すこと、counterparty_idはPL区分(revenue/expense)の行にだけ設定すること、
 * 精算バッチのタグを行に引き継ぐこと、確認パネルで編集した行(lines)で置き換えられること、
 * 明細行の世帯メンバーが「科目の既定メンバー > 行の世帯メンバー > 起票者」の順で必ず確定することを検証する
 * (計画Issue #169・#180)。計画Issue #164で追加した、土日の調整後の日付をentryDateにすること、調整前の
 * 期日をrecurringDueDateに記録すること、摘要(既定はルール名)とコメントを仕訳に設定することも検証する。
 * 科目区分(AccountCategory)の解決は呼び出し側の責務(既存のbuildCounterpartyExpenseSplitting
 * JournalEntryInput等と同じパターン)のため、本関数はDB非依存・外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { AccountCategory } from '../account/Account'
import { createLineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import type { RecurringTransactionRule, RecurringTransactionRuleLine } from './RecurringTransactionRule'
import { buildRecurringTransactionJournalEntryInput } from './buildRecurringTransactionJournalEntryInput'

/** 科目に既定の世帯メンバーが無い前提で、起票者(1)を既定値にする */
const resolveLineHouseholdMemberId = createLineHouseholdMemberResolver([], 1)

const CATEGORIES: ReadonlyMap<number, AccountCategory> = new Map<number, AccountCategory>([
  [10, 'expense'],
  [11, 'expense'],
  [20, 'liability'],
  [30, 'asset'],
])

function line(overrides: Partial<RecurringTransactionRuleLine>): RecurringTransactionRuleLine {
  return {
    lineNo: 1,
    side: 'debit',
    accountId: 10,
    amount: 80000,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    ...overrides,
  }
}

/** 既定は借方10(費用)・貸方20(負債)の2行ルール */
function makeRule(overrides: Partial<RecurringTransactionRule> = {}): RecurringTransactionRule {
  return {
    id: 1,
    name: '家賃',
    bookkeeperHouseholdMemberId: null,
    lines: [line({ lineNo: 1, side: 'debit', accountId: 10 }), line({ lineNo: 2, side: 'credit', accountId: 20 })],
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 1,
    weekOfMonth: null,
    monthOfYear: null,
    maxOccurrences: null,
    startsOn: '2026-06-01',
    endsOn: null,
    interval: 1,
    weekendAdjustment: 'none',
    amountMode: 'fixed',
    resumedOn: null,
    isActive: true,
    createdAt: '2026-06-01 00:00:00',
    updatedAt: '2026-06-01 00:00:00',
    ...overrides,
  }
}

const build = (
  rule: RecurringTransactionRule,
  dueDate = '2026-09-01',
  extra: Partial<Parameters<typeof buildRecurringTransactionJournalEntryInput>[0]> = {},
) =>
  buildRecurringTransactionJournalEntryInput({
    rule,
    dueDate,
    bookkeeperHouseholdMemberId: 1,
    accountCategoryById: CATEGORIES,
    resolveLineHouseholdMemberId,
    ...extra,
  })

describe('buildRecurringTransactionJournalEntryInput', () => {
  describe('行の写し方', () => {
    it('ルールの行を、行番号の順に仕訳の明細行へ写す(3行以上の複合仕訳も同じ)', () => {
      const rule = makeRule({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 30, amount: 280000 }),
          line({ lineNo: 2, side: 'debit', accountId: 11, amount: 80000 }),
          line({ lineNo: 3, side: 'credit', accountId: 20, amount: 360000 }),
        ],
      })

      const input = build(rule)

      expect(input.lines.map((l) => [l.accountId, l.side, l.amount])).toEqual([
        [30, 'debit', 280000],
        [11, 'debit', 80000],
        [20, 'credit', 360000],
      ])
    })

    it('行のプロジェクト・取引先(PL科目の行)・精算バッチをその行に設定する', () => {
      const rule = makeRule({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 10, projectId: 7, counterpartyId: 5 }),
          line({ lineNo: 2, side: 'credit', accountId: 20, settlementBatchId: 9 }),
        ],
      })

      const [debit, credit] = build(rule).lines

      expect(debit).toMatchObject({ projectId: 7, counterpartyId: 5, settlementBatchId: null })
      expect(credit).toMatchObject({ projectId: null, counterpartyId: null, settlementBatchId: 9 })
    })

    it('取引先はPL区分(収益・費用)でない科目の行には設定しない(防御。保存時にもDBが拒否する)', () => {
      const rule = makeRule({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 30, counterpartyId: 5 }),
          line({ lineNo: 2, side: 'credit', accountId: 20, counterpartyId: 5 }),
        ],
      })

      for (const l of build(rule).lines) expect(l.counterpartyId).toBeNull()
    })

    it('lineAmountsで行番号ごとに金額を上書きできる(前回確定額・金額表の初期値)', () => {
      const input = build(makeRule(), '2026-09-01', {
        lineAmounts: new Map([
          [1, 85000],
          [2, 85000],
        ]),
      })

      expect(input.lines.map((l) => l.amount)).toEqual([85000, 85000])
    })

    it('linesを渡すと、ルールの行ではなく確認パネルで編集した行で置き換える(行の追加・削除・科目の変更)', () => {
      const edited = [
        { accountId: 30, side: 'debit' as const, amount: 100, householdMemberId: 4 },
        { accountId: 20, side: 'credit' as const, amount: 60, householdMemberId: 4 },
        { accountId: 11, side: 'credit' as const, amount: 40, householdMemberId: 4, counterpartyId: 3 },
      ]

      const input = build(makeRule(), '2026-09-01', { lines: edited })

      expect(
        input.lines.map((l) => [l.accountId, l.side, l.amount, l.householdMemberId, l.counterpartyId ?? null]),
      ).toEqual([
        [30, 'debit', 100, 4, null],
        [20, 'credit', 60, 4, null],
        [11, 'credit', 40, 4, 3],
      ])
    })
  })

  describe('明細行の世帯メンバー(計画Issue #169・#180)', () => {
    it('行の世帯メンバーが無ければ、起票者になる(明細行は常に世帯メンバーを持つ)', () => {
      expect(build(makeRule()).lines.map((l) => l.householdMemberId)).toEqual([1, 1])
    })

    it('行ごとの世帯メンバーは、その行にだけ使う', () => {
      const rule = makeRule({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 10, householdMemberId: 3 }),
          line({ lineNo: 2, side: 'credit', accountId: 20 }),
        ],
      })

      expect(build(rule).lines.map((l) => l.householdMemberId)).toEqual([3, 1])
    })

    it('科目に既定の世帯メンバーがあれば、その行は行の世帯メンバーより既定値が優先される', () => {
      const rule = makeRule({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 10, householdMemberId: 3 }),
          line({ lineNo: 2, side: 'credit', accountId: 20, householdMemberId: 3 }),
        ],
      })

      const input = build(rule, '2026-09-01', {
        resolveLineHouseholdMemberId: createLineHouseholdMemberResolver([{ id: 20, householdMemberId: 9 }], 1),
      })

      expect(input.lines.map((l) => l.householdMemberId)).toEqual([3, 9])
    })

    it('起票者は引数の起票者(ルールの起票者の解決は呼び出し側)を仕訳に設定する', () => {
      expect(build(makeRule(), '2026-09-01', { bookkeeperHouseholdMemberId: 2 }).householdMemberId).toBe(2)
    })
  })

  it('sourceType=recurring_generated・generatedFromRuleId・entryDateを設定する', () => {
    const input = build(makeRule({ id: 42 }))

    expect(input.sourceType).toBe('recurring_generated')
    expect(input.generatedFromRuleId).toBe(42)
    expect(input.entryDate).toBe('2026-09-01')
    expect(input.householdMemberId).toBe(1)
  })

  describe('土日の調整・期日の記録・摘要とコメント(計画Issue #164)', () => {
    it('調整後の日付がentryDateになり、調整前の期日がrecurringDueDateに記録される(2026-01-25は日曜日)', () => {
      const input = build(makeRule({ weekendAdjustment: 'previous' }), '2026-01-25')

      expect(input.entryDate).toBe('2026-01-23')
      expect(input.recurringDueDate).toBe('2026-01-25')
    })

    it('翌平日の調整では、土日の期日が翌月曜日のentryDateになる', () => {
      expect(build(makeRule({ weekendAdjustment: 'next' }), '2026-01-24').entryDate).toBe('2026-01-26')
    })

    it('調整なし・平日の期日は、期日がそのままentryDateにもrecurringDueDateにもなる', () => {
      const input = build(makeRule({ weekendAdjustment: 'previous' }), '2026-01-23')

      expect(input.entryDate).toBe('2026-01-23')
      expect(input.recurringDueDate).toBe('2026-01-23')
    })

    it('摘要を省略するとルール名になる', () => {
      expect(build(makeRule({ name: '家賃' })).memo).toBe('家賃')
    })

    it('摘要とコメントを指定すると、確認パネルで編集した値が仕訳に設定される', () => {
      const input = build(makeRule({ name: '家賃' }), '2026-09-01', { memo: '家賃 9月分', comment: '更新料は別途' })

      expect(input.memo).toBe('家賃 9月分')
      expect(input.comment).toBe('更新料は別途')
    })

    it('摘要を空にすると摘要なし(null)になり、コメントを省略するとnullになる', () => {
      const input = build(makeRule({ name: '家賃' }), '2026-09-01', { memo: '  ' })

      expect(input.memo).toBeNull()
      expect(input.comment).toBeNull()
    })
  })
})
