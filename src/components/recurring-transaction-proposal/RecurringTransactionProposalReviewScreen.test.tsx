// @vitest-environment jsdom
/**
 * 定期取引の提案レビュー画面(計画Issue #39)のコンポーネントテスト。
 * createRecurringTransactionProposalApi(計画Issue #121)が返す保留中の提案一覧の表示、
 * 「そのルールについて最も古い対象日のみ確認操作ができる」制約
 * (docs/domain/recurring-transactions.md 1.2節「前回チェック日」の逆算方式の欠陥を防ぐための
 * 昇順限定confirm)のUI表現、レビュー時の金額編集(2.1節)、ルールにhouseholdMemberIdが
 * 未設定の場合の起票者選択(RecurringTransactionHouseholdMemberRequiredError回避)を、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { createRecurringTransactionProposalApi } from '../../infrastructure/rpc/createRecurringTransactionProposalApi'
import { RecurringTransactionProposalReviewScreen } from './RecurringTransactionProposalReviewScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let ruleRepository: SqlJsRecurringTransactionRuleRepository
let proposalApi: ReturnType<typeof createRecurringTransactionProposalApi>
let expenseAccountId: number
let liabilityAccountId: number
let memberId: number

function insertGeneratedEntry(ruleId: number, entryDate: string): void {
  db.run(
    `INSERT INTO journal_entries (entry_date, source_type, generated_from_rule_id, household_member_id)
     VALUES (?, 'recurring_generated', ?, ?)`,
    [entryDate, ruleId, memberId],
  )
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  ruleRepository = new SqlJsRecurringTransactionRuleRepository(db)
  proposalApi = createRecurringTransactionProposalApi(db, journalEntryRepository)
  expenseAccountId = accountRepository.create({ category: 'expense', name: '家賃', isReconcilable: null }).id
  liabilityAccountId = accountRepository.create({ category: 'liability', name: '未払金', isReconcilable: false }).id
  memberId = householdMemberRepository.create({ name: '自分' }).id
  // Dateのみを固定し、setTimeout/setIntervalは実タイマーのままにする(Testing Libraryの
  // findByText/waitForは実タイマーのポーリングに依存するため、全体をfakeTimers化すると
  // ポーリングが進まずタイムアウトする)。
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RecurringTransactionProposalReviewScreen
        recurringTransactionProposalApi={proposalApi}
        recurringTransactionRuleRepository={ruleRepository}
        householdMemberRepository={householdMemberRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('RecurringTransactionProposalReviewScreen', () => {
  it('保留中の提案がない場合は空状態のメッセージを表示する', async () => {
    renderScreen()
    expect(await screen.findByText('確認待ちの定期取引がありません')).toBeInTheDocument()
  })

  it('保留中の提案がルール名・対象日とともに表示され、確認すると仕訳が生成されて一覧から消える', async () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    renderScreen()

    expect(await screen.findByText('家賃')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確認して仕訳を作成する' }))

    await waitFor(() => expect(screen.queryByText('家賃')).not.toBeInTheDocument())
    // insertGeneratedEntryで挿入した明細なしの1件(前回チェック日用)に加え、confirmで新規生成された1件がある
    expect(journalEntryRepository.findAll().filter((e) => e.lines.length > 0)).toHaveLength(1)
  })

  it('同一ルールに複数の保留中対象日がある場合、最も古い対象日のみ確認操作ができる', async () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-07-01')
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'))

    renderScreen()

    expect(await screen.findByText('2026-08-01')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-01')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '確認して仕訳を作成する' })).toHaveLength(1)
    expect(screen.getByText('ほか1件が保留中です(古い順に確認してください)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確認して仕訳を作成する' }))

    expect(await screen.findByText('2026-09-01')).toBeInTheDocument()
    expect(screen.queryByText(/ほか\d+件/)).not.toBeInTheDocument()
  })

  it('金額を編集してから確認すると、編集後の金額で仕訳が生成される', async () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    renderScreen()
    await screen.findByText('家賃')

    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '85000' } })
    fireEvent.click(screen.getByRole('button', { name: '確認して仕訳を作成する' }))

    await waitFor(() =>
      expect(journalEntryRepository.findAll().filter((e) => e.lines.length > 0)).toHaveLength(1),
    )
    const [entry] = journalEntryRepository.findAll().filter((e) => e.lines.length > 0)
    expect(entry.lines.map((l) => l.amount)).toEqual([85000, 85000])
  })

  it('ルールにhouseholdMemberIdが未設定の場合、世帯メンバーを選択するまで確認できない', async () => {
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    renderScreen()
    await screen.findByText('家賃')

    expect(screen.getByRole('button', { name: '確認して仕訳を作成する' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('起票者(世帯メンバー)を選択してください'), {
      target: { value: String(memberId) },
    })
    expect(screen.getByRole('button', { name: '確認して仕訳を作成する' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '確認して仕訳を作成する' }))

    await waitFor(() =>
      expect(journalEntryRepository.findAll().filter((e) => e.lines.length > 0)).toHaveLength(1),
    )
    expect(journalEntryRepository.findAll().find((e) => e.lines.length > 0)?.householdMemberId).toBe(memberId)
  })

  it('確認ボタンクリック前に他経路(別タブ等)で同じ対象日が確認され同期例外(昇順違反)になった場合、エラーメッセージが表示され確認ボタンが再び有効になる', async () => {
    // 画面ロード時点では対象日2026-09-01が最古の保留中対象日だが、クリック前に別経路で
    // confirmされ、次回チェック日が前進したとする(confirmは同期関数であり、この違反は
    // 同期的にthrowされる、createRecurringTransactionProposalApi.ts参照)。Promise.resolve(fn())
    // のままだとこの例外が.catch()に届かずisSubmittingがtrueに固定されたままボタンが
    // 恒久的に無効化される(Promise.resolve().then(() => fn())への修正のリグレッションテスト、
    // コミットffafcc9)。
    const rule = ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
      householdMemberId: memberId,
    })
    insertGeneratedEntry(rule.id, '2026-08-01')
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))

    renderScreen()
    const confirmButton = await screen.findByRole('button', { name: '確認して仕訳を作成する' })

    proposalApi.confirm({ ruleId: rule.id, dueDate: '2026-09-01' })

    fireEvent.click(confirmButton)

    expect(await screen.findByText('仕訳の作成に失敗しました。もう一度お試しください。')).toBeInTheDocument()
    await waitFor(() => expect(confirmButton).toBeEnabled())
  })
})
