// @vitest-environment jsdom
/**
 * 定期取引ルール管理画面(計画Issue #39)のコンポーネントテスト。登録済みルールの一覧表示、
 * frequency(weekly/monthly日付指定/monthly曜日指定/yearly)ごとに入力項目が切り替わる
 * 条件分岐フォームでの新規作成・編集、生成済み仕訳の有無による削除可否の分岐
 * (docs/domain/recurring-transactions.md 1.6節)、非アクティブ化を、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
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
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { RecurringTransactionRuleManagementScreen } from './RecurringTransactionRuleManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let projectRepository: SqlJsProjectRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let ruleRepository: SqlJsRecurringTransactionRuleRepository
let expenseAccountId: number
let liabilityAccountId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  ruleRepository = new SqlJsRecurringTransactionRuleRepository(db)
  expenseAccountId = accountRepository.create({ category: 'expense', name: '通信費', isReconcilable: null }).id
  liabilityAccountId = accountRepository.create({ category: 'liability', name: '未払金', isReconcilable: false }).id
  // is_reconcilable = trueの科目は選択肢から除外されることを検証するために登録しておく
  accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  memberId = householdMemberRepository.create({ name: '自分' }).id
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RecurringTransactionRuleManagementScreen
        recurringTransactionRuleRepository={ruleRepository}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('RecurringTransactionRuleManagementScreen', () => {
  it('登録済みルールがない場合は空状態のメッセージを表示する', async () => {
    renderScreen()
    expect(await screen.findByText('登録済みの定期取引ルールがありません')).toBeInTheDocument()
  })

  it('is_reconcilable=trueの科目は借方・貸方の選択肢から除外される', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引ルールを追加' }))

    const debitSelect = screen.getByLabelText('借方科目') as HTMLSelectElement
    const optionNames = Array.from(debitSelect.options).map((o) => o.textContent)
    expect(optionNames).toContain('通信費')
    expect(optionNames).not.toContain('普通預金')
  })

  it('weeklyのルールを作成すると一覧に「毎週◯曜日」形式で表示される', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引ルールを追加' }))

    fireEvent.change(screen.getByLabelText('ルール名'), { target: { value: 'お小遣い' } })
    fireEvent.change(screen.getByLabelText('借方科目'), { target: { value: String(expenseAccountId) } })
    fireEvent.change(screen.getByLabelText('貸方科目'), { target: { value: String(liabilityAccountId) } })
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('繰り返し'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('曜日'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('お小遣い')).toBeInTheDocument()
    expect(await screen.findByText('毎週月曜日')).toBeInTheDocument()
  })

  it('monthly(日付指定)のルールを作成すると一覧に「毎月◯日」形式で表示される', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引ルールを追加' }))

    fireEvent.change(screen.getByLabelText('ルール名'), { target: { value: '家賃' } })
    fireEvent.change(screen.getByLabelText('借方科目'), { target: { value: String(expenseAccountId) } })
    fireEvent.change(screen.getByLabelText('貸方科目'), { target: { value: String(liabilityAccountId) } })
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '80000' } })
    fireEvent.change(screen.getByLabelText('繰り返し'), { target: { value: 'monthly' } })
    // 既定は「日付で指定」モード
    fireEvent.change(screen.getByLabelText('日'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('家賃')).toBeInTheDocument()
    expect(await screen.findByText('毎月1日')).toBeInTheDocument()
  })

  it('monthly(曜日指定)のルールを作成すると一覧に「毎月第◯◯曜日」形式で表示される', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引ルールを追加' }))

    fireEvent.change(screen.getByLabelText('ルール名'), { target: { value: 'お小遣い(第2土曜日)' } })
    fireEvent.change(screen.getByLabelText('借方科目'), { target: { value: String(expenseAccountId) } })
    fireEvent.change(screen.getByLabelText('貸方科目'), { target: { value: String(liabilityAccountId) } })
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText('繰り返し'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('指定方法'), { target: { value: 'weekday' } })
    fireEvent.change(screen.getByLabelText('第◯週'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('曜日'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('お小遣い(第2土曜日)')).toBeInTheDocument()
    expect(await screen.findByText('毎月第2土曜日')).toBeInTheDocument()
  })

  it('yearlyのルールを作成すると一覧に「毎年◯月◯日」形式で表示される', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引ルールを追加' }))

    fireEvent.change(screen.getByLabelText('ルール名'), { target: { value: '保険料' } })
    fireEvent.change(screen.getByLabelText('借方科目'), { target: { value: String(expenseAccountId) } })
    fireEvent.change(screen.getByLabelText('貸方科目'), { target: { value: String(liabilityAccountId) } })
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('繰り返し'), { target: { value: 'yearly' } })
    fireEvent.change(screen.getByLabelText('月'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('日'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('保険料')).toBeInTheDocument()
    expect(await screen.findByText('毎年6月1日')).toBeInTheDocument()
  })

  it('編集でfrequencyを変更すると入力項目が切り替わり、変更後の内容で保存できる', async () => {
    ruleRepository.create({
      name: '家賃',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 80000,
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    renderScreen()

    fireEvent.click(await screen.findByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('繰り返し'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('曜日'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('毎週水曜日')).toBeInTheDocument()
  })

  it('生成済み仕訳が0件のルールは削除でき、一覧から消える', async () => {
    ruleRepository.create({
      name: '一度も生成されていないルール',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 500,
      frequency: 'weekly',
      dayOfWeek: 0,
    })
    renderScreen()

    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() =>
      expect(screen.queryByText('一度も生成されていないルール')).not.toBeInTheDocument(),
    )
  })

  it('生成済み仕訳が1件以上あるルールは削除ボタンが表示されず、理由と非アクティブ化ボタンが表示される', async () => {
    const rule = ruleRepository.create({
      name: '記帳済みルール',
      debitAccountId: expenseAccountId,
      creditAccountId: liabilityAccountId,
      amount: 500,
      frequency: 'weekly',
      dayOfWeek: 0,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-06',
      memo: null,
      householdMemberId: memberId,
      generatedFromRuleId: rule.id,
      lines: [
        { accountId: expenseAccountId, side: 'debit', amount: 500 },
        { accountId: liabilityAccountId, side: 'credit', amount: 500 },
      ],
    })
    renderScreen()

    const item = await screen.findByText('記帳済みルール')
    expect(item).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
    expect(
      screen.getByText('生成済みの仕訳があるため削除できません(非アクティブ化のみ可能です)'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '非アクティブ化' }))
    expect(await screen.findByText('非アクティブ')).toBeInTheDocument()
  })
})
