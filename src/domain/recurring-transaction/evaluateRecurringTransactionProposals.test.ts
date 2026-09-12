/**
 * evaluateRecurringTransactionProposals(定期取引ルールの提案評価)の純粋関数としての
 * ユニットテスト。docs/domain/recurring-transactions.md 1.2節「前回チェック日から現在までの
 * 間で発生すべき対象日をまとめて遅延評価し、提案を生成する」を、専用のチェックポイントを
 * 永続化せず「このルールから生成済みの最新entry_date」を起点として使う設計(1.6節の
 * 非アクティブ化・2.1節のmax_occurrences)で検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import {
  evaluateRecurringTransactionProposals,
  type RecurringTransactionRuleGenerationState,
} from './evaluateRecurringTransactionProposals'

function makeRule(overrides: Partial<RecurringTransactionRule>): RecurringTransactionRule {
  return {
    id: 1,
    name: 'テストルール',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: 1000,
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 1,
    weekOfMonth: null,
    monthOfYear: null,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    maxOccurrences: null,
    isActive: true,
    createdAt: '2026-06-01 00:00:00',
    updatedAt: '2026-06-01 00:00:00',
    ...overrides,
  }
}

function makeState(
  overrides: Partial<RecurringTransactionRuleGenerationState> &
    Pick<RecurringTransactionRuleGenerationState, 'rule'>,
): RecurringTransactionRuleGenerationState {
  return {
    generatedCount: 0,
    latestGeneratedEntryDate: null,
    ...overrides,
  }
}

describe('evaluateRecurringTransactionProposals', () => {
  it('生成済みの仕訳が無いルールは、作成日(日付部分)より後の対象日を提案として返す', () => {
    const rule = makeRule({ id: 1, createdAt: '2026-06-15 12:00:00' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule })],
      '2026-09-01',
    )

    expect(proposals).toEqual([
      { ruleId: 1, dueDate: '2026-07-01' },
      { ruleId: 1, dueDate: '2026-08-01' },
      { ruleId: 1, dueDate: '2026-09-01' },
    ])
  })

  it('生成済みの仕訳があるルールは、最新entry_dateより後の対象日のみ提案する', () => {
    const rule = makeRule({ id: 1, createdAt: '2026-01-01 00:00:00' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule, generatedCount: 3, latestGeneratedEntryDate: '2026-08-01' })],
      '2026-09-01',
    )

    expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
  })

  it('非アクティブなルールは提案しない(1.6節)', () => {
    const rule = makeRule({ id: 1, isActive: false, createdAt: '2026-01-01 00:00:00' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule })],
      '2026-09-01',
    )

    expect(proposals).toEqual([])
  })

  it('max_occurrencesの残数が0のルールは提案しない(2.1節)', () => {
    const rule = makeRule({ id: 1, maxOccurrences: 3, createdAt: '2026-01-01 00:00:00' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule, generatedCount: 3, latestGeneratedEntryDate: '2026-03-01' })],
      '2026-09-01',
    )

    expect(proposals).toEqual([])
  })

  it('複数ルールを対象に、それぞれ独立して評価する', () => {
    const rentRule = makeRule({ id: 1, createdAt: '2026-01-01 00:00:00' })
    const salaryRule = makeRule({
      id: 2,
      dayOfMonth: 25,
      createdAt: '2026-01-01 00:00:00',
    })

    const proposals = evaluateRecurringTransactionProposals(
      [
        makeState({ rule: rentRule, generatedCount: 1, latestGeneratedEntryDate: '2026-08-01' }),
        makeState({ rule: salaryRule, generatedCount: 1, latestGeneratedEntryDate: '2026-08-25' }),
      ],
      '2026-09-25',
    )

    expect(proposals).toEqual([
      { ruleId: 1, dueDate: '2026-09-01' },
      { ruleId: 2, dueDate: '2026-09-25' },
    ])
  })
})
