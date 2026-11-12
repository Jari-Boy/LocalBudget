/**
 * evaluateRecurringTransactionProposals(定期取引ルールの提案評価)の純粋関数としての
 * ユニットテスト。docs/domain/recurring-transactions.md 1.2節「前回チェック日から現在までの
 * 間で発生すべき対象日をまとめて遅延評価し、提案を生成する」を、専用のチェックポイントを
 * 永続化せず「このルールから生成済みの最新entry_date」を起点として使う設計(1.6節の
 * 非アクティブ化・2.1節のmax_occurrences)で検証する。計画Issue #145で追加した提案の見送り
 * (見送った最新の対象日も起点に含める。確定と見送りが混ざっても導出できる、見送りは
 * max_occurrencesの回数に数えない)も検証する。計画Issue #164で、起点を「生成済みの最新の期日
 * (recurring_due_date)・見送った最新の期日・開始日の前日・再開日の前日のうち最も新しい日」に
 * 変えた挙動(開始日の当日を含む、再開日の当日を含む、大小が逆でも新しいほうを採る)も検証する。
 * DB非依存、外部依存なし。
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
    bookkeeperHouseholdMemberId: null,
    lines: [
      { lineNo: 1, side: 'debit', accountId: 1, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      { lineNo: 2, side: 'credit', accountId: 2, amount: 1000, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ],
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

function makeState(
  overrides: Partial<RecurringTransactionRuleGenerationState> &
    Pick<RecurringTransactionRuleGenerationState, 'rule'>,
): RecurringTransactionRuleGenerationState {
  return {
    generatedCount: 0,
    latestGeneratedDueDate: null,
    latestSkippedDueDate: null,
    ...overrides,
  }
}

describe('evaluateRecurringTransactionProposals', () => {
  it('生成済みの仕訳が無いルールは、開始日(当日を含む)以降の対象日を提案として返す', () => {
    const rule = makeRule({ id: 1, startsOn: '2026-06-15' })

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

  it('生成済みの仕訳があるルールは、最新の期日より後の対象日のみ提案する', () => {
    const rule = makeRule({ id: 1, startsOn: '2026-01-01' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule, generatedCount: 3, latestGeneratedDueDate: '2026-08-01' })],
      '2026-09-01',
    )

    expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
  })

  it('非アクティブなルールは提案しない(1.6節)', () => {
    const rule = makeRule({ id: 1, isActive: false, startsOn: '2026-01-01' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule })],
      '2026-09-01',
    )

    expect(proposals).toEqual([])
  })

  it('max_occurrencesの残数が0のルールは提案しない(2.1節)', () => {
    const rule = makeRule({ id: 1, maxOccurrences: 3, startsOn: '2026-01-01' })

    const proposals = evaluateRecurringTransactionProposals(
      [makeState({ rule, generatedCount: 3, latestGeneratedDueDate: '2026-03-01' })],
      '2026-09-01',
    )

    expect(proposals).toEqual([])
  })

  it('複数ルールを対象に、それぞれ独立して評価する', () => {
    const rentRule = makeRule({ id: 1, startsOn: '2026-01-01' })
    const salaryRule = makeRule({
      id: 2,
      dayOfMonth: 25,
      startsOn: '2026-01-01',
    })

    const proposals = evaluateRecurringTransactionProposals(
      [
        makeState({ rule: rentRule, generatedCount: 1, latestGeneratedDueDate: '2026-08-01' }),
        makeState({ rule: salaryRule, generatedCount: 1, latestGeneratedDueDate: '2026-08-25' }),
      ],
      '2026-09-25',
    )

    expect(proposals).toEqual([
      { ruleId: 1, dueDate: '2026-09-01' },
      { ruleId: 2, dueDate: '2026-09-25' },
    ])
  })

  describe('提案の見送り(計画Issue #145)', () => {
    it('見送った最新の対象日より後の対象日だけを提案として返す', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-06-01' })

      const proposals = evaluateRecurringTransactionProposals(
        [makeState({ rule, latestSkippedDueDate: '2026-07-01' })],
        '2026-09-01',
      )

      expect(proposals).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
        { ruleId: 1, dueDate: '2026-09-01' },
      ])
    })

    it('確定と見送りが混ざる場合、新しいほうを起点にする(確定のあとに見送った場合)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-06-01' })

      const proposals = evaluateRecurringTransactionProposals(
        [
          makeState({
            rule,
            generatedCount: 1,
            latestGeneratedDueDate: '2026-07-01',
            latestSkippedDueDate: '2026-08-01',
          }),
        ],
        '2026-09-01',
      )

      expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
    })

    it('確定と見送りが混ざる場合、新しいほうを起点にする(見送りのあとに確定した場合)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-06-01' })

      const proposals = evaluateRecurringTransactionProposals(
        [
          makeState({
            rule,
            generatedCount: 1,
            latestGeneratedDueDate: '2026-08-01',
            latestSkippedDueDate: '2026-07-01',
          }),
        ],
        '2026-09-01',
      )

      expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
    })

    it('最後の提案を見送ると、未処理の提案は残らない', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-06-01' })

      const proposals = evaluateRecurringTransactionProposals(
        [makeState({ rule, latestSkippedDueDate: '2026-09-01' })],
        '2026-09-01',
      )

      expect(proposals).toEqual([])
    })

    it('見送りはmax_occurrencesの回数に数えない(見送った分だけ終わりが後ろへずれる)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-06-01', maxOccurrences: 2 })

      const proposals = evaluateRecurringTransactionProposals(
        [makeState({ rule, generatedCount: 1, latestGeneratedDueDate: '2026-07-01', latestSkippedDueDate: '2026-08-01' })],
        '2026-12-01',
      )

      // 生成済みは1件なので、あと1回だけ提案される(見送りで消費した回は数えない)
      expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
    })
  })

  describe('提案の起点(計画Issue #164)', () => {
    it('開始日の当日が期日なら提案に含め、開始日より前の期日は提案しない', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-08-01' })

      expect(evaluateRecurringTransactionProposals([makeState({ rule })], '2026-09-01')).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
        { ruleId: 1, dueDate: '2026-09-01' },
      ])
    })

    it('再開日の当日が期日なら提案に含め、再開日より前の期日は提案しない', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-01-01', resumedOn: '2026-08-01' })

      expect(evaluateRecurringTransactionProposals([makeState({ rule })], '2026-09-01')).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
        { ruleId: 1, dueDate: '2026-09-01' },
      ])
    })

    it('過去の再開日を選ぶと、その日以降の期日が提案される(無効にしていた間の期日も出せる)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-01-01', resumedOn: '2026-06-15' })

      expect(evaluateRecurringTransactionProposals([makeState({ rule })], '2026-08-01')).toEqual([
        { ruleId: 1, dueDate: '2026-07-01' },
        { ruleId: 1, dueDate: '2026-08-01' },
      ])
    })

    it('再開日より新しい生成済みの期日があれば、そちらを起点にする(大小が逆でも新しいほうが採られる)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-01-01', resumedOn: '2026-06-15' })

      const proposals = evaluateRecurringTransactionProposals(
        [makeState({ rule, generatedCount: 1, latestGeneratedDueDate: '2026-07-01' })],
        '2026-09-01',
      )

      expect(proposals).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
        { ruleId: 1, dueDate: '2026-09-01' },
      ])
    })

    it('生成済みの期日より新しい再開日があれば、そちらを起点にする(無効化→再有効化を繰り返しても更新される)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-01-01', resumedOn: '2026-08-15' })

      const proposals = evaluateRecurringTransactionProposals(
        [makeState({ rule, generatedCount: 1, latestGeneratedDueDate: '2026-06-01' })],
        '2026-09-01',
      )

      expect(proposals).toEqual([{ ruleId: 1, dueDate: '2026-09-01' }])
    })

    it('生成済みの期日・見送った期日・開始日・再開日のうち最も新しい日を起点にする(見送りが最新)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-02-01', resumedOn: '2026-04-01' })

      const proposals = evaluateRecurringTransactionProposals(
        [
          makeState({
            rule,
            generatedCount: 1,
            latestGeneratedDueDate: '2026-05-01',
            latestSkippedDueDate: '2026-06-01',
          }),
        ],
        '2026-08-01',
      )

      expect(proposals).toEqual([
        { ruleId: 1, dueDate: '2026-07-01' },
        { ruleId: 1, dueDate: '2026-08-01' },
      ])
    })

    it('間隔のあるルールは、再開しても周期がずれない(1月開始の3か月ごとを2月に再開しても4月・7月)', () => {
      const rule = makeRule({ id: 1, interval: 3, startsOn: '2026-01-01', resumedOn: '2026-02-01' })

      expect(evaluateRecurringTransactionProposals([makeState({ rule })], '2026-08-01')).toEqual([
        { ruleId: 1, dueDate: '2026-04-01' },
        { ruleId: 1, dueDate: '2026-07-01' },
      ])
    })

    it('終了日を過ぎた期日は提案しない。終了日を延ばすと、再び提案が出る', () => {
      const ended = makeRule({ id: 1, startsOn: '2026-06-01', endsOn: '2026-07-01' })
      expect(evaluateRecurringTransactionProposals([makeState({ rule: ended })], '2026-09-01')).toEqual([
        { ruleId: 1, dueDate: '2026-06-01' },
        { ruleId: 1, dueDate: '2026-07-01' },
      ])

      const extended = { ...ended, endsOn: '2026-09-01' }
      expect(
        evaluateRecurringTransactionProposals(
          [makeState({ rule: extended, generatedCount: 2, latestGeneratedDueDate: '2026-07-01' })],
          '2026-09-01',
        ),
      ).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
        { ruleId: 1, dueDate: '2026-09-01' },
      ])
    })

    it('土日の調整は期日を変えない(提案の期日は調整前のまま。2026-08-01は土曜日)', () => {
      const rule = makeRule({ id: 1, startsOn: '2026-08-01', weekendAdjustment: 'previous' })

      expect(evaluateRecurringTransactionProposals([makeState({ rule })], '2026-08-01')).toEqual([
        { ruleId: 1, dueDate: '2026-08-01' },
      ])
    })
  })
})
