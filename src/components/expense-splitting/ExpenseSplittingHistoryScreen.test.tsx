// @vitest-environment jsdom
/**
 * 割勘履歴一覧画面(計画Issue #110)のコンポーネントテスト。個々の元仕訳を事前に
 * 把握していなくても、これまでに行われた割勘(allocatesリンクのfrom_entry側に
 * 登場する仕訳)を横断的に一覧表示できることを、世帯メンバー間の割勘・世帯外の相手との
 * 割勘・複数元仕訳をまとめた割勘・精算済みの割勘・履歴が0件の場合を通じて検証する
 * (docs/domain/expense-splitting.md 1.5節)。listExpenseSplittingHistory・
 * resolveExpenseSplittingParticipant・isExpenseSplittingEntrySettledの3関数を
 * 実際に組み合わせて使うため、モックではなくsql.jsのNode実装(createTestDatabase)を
 * 使った統合的なレンダリングテストとする。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { buildCounterpartyExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildCounterpartyExpenseSplittingJournalEntryInput'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { ExpenseSplittingHistoryScreen } from './ExpenseSplittingHistoryScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let projectRepository: SqlJsProjectRepository
let counterpartyRepository: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
})

afterEach(cleanup)

function renderScreen(overrides?: { onSelectEntry?: (entry: JournalEntry) => void; onBack?: () => void }) {
  const onSelectEntry = overrides?.onSelectEntry ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExpenseSplittingHistoryScreen
        journalEntryRepository={journalEntryRepository}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onSelectEntry={onSelectEntry}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onBack }
}

function setUpAdvanceAccounts() {
  const advanceAsset = accountRepository.create({
    category: 'asset',
    name: '立替金',
    isReconcilable: false,
    isSystemManaged: true,
  })
  const advanceLiability = accountRepository.create({
    category: 'liability',
    name: '立替金',
    isReconcilable: false,
    isSystemManaged: true,
  })
  return { advanceAsset, advanceLiability }
}

describe('ExpenseSplittingHistoryScreen', () => {
  it('割勘の履歴が1件もない場合、空状態のメッセージを表示する', async () => {
    renderScreen()

    expect(await screen.findByText('割勘の履歴はありません')).toBeInTheDocument()
  })

  it('世帯メンバー間の割勘は、分担者名・金額・未精算の状態・所属プロジェクト名を一覧表示する', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalEntryId: originalEntry.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        projectId: project.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )

    renderScreen()

    expect(await screen.findByText('スーパーで食材購入')).toBeInTheDocument()
    expect(screen.getByText('Bさん')).toBeInTheDocument()
    expect(screen.getByText('￥500')).toBeInTheDocument()
    expect(screen.getByText('未精算')).toBeInTheDocument()
    expect(screen.getByText('26/8生活費割勘')).toBeInTheDocument()
  })

  it('世帯外の相手との割勘は、取引先名を分担者として一覧表示する', async () => {
    const { advanceAsset } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const friend = counterpartyRepository.create({ name: '友人Cさん' })
    const project = projectRepository.create({ name: '26/8旅行費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '旅行費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-05',
      memo: 'ホテル代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 2000 },
        { accountId: cash.id, side: 'credit', amount: 2000 },
      ],
    })
    journalEntryRepository.create(
      buildCounterpartyExpenseSplittingJournalEntryInput({
        originalEntryId: originalEntry.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        payerMemberId: member.id,
        counterpartyId: friend.id,
        projectId: project.id,
        amount: 1000,
        entryDate: '2026-08-06',
      }),
    )

    renderScreen()

    expect(await screen.findByText('ホテル代')).toBeInTheDocument()
    expect(screen.getByText('友人Cさん')).toBeInTheDocument()
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、元の支出を件数でまとめて表示する', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const smartphoneEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スマホ代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const tabletEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: 'タブレット代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })
    const splitInputForSmartphone = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: smartphoneEntry.id,
      expenseAccountId: expense.id,
      advanceAssetAccountId: advanceAsset.id,
      advanceLiabilityAccountId: advanceLiability.id,
      fromMemberId: member.id,
      toMemberId: other.id,
      projectId: project.id,
      amount: 500,
      entryDate: '2026-08-03',
    })
    const splitInputForTablet = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: tabletEntry.id,
      expenseAccountId: expense.id,
      advanceAssetAccountId: advanceAsset.id,
      advanceLiabilityAccountId: advanceLiability.id,
      fromMemberId: member.id,
      toMemberId: other.id,
      projectId: project.id,
      amount: 250,
      entryDate: '2026-08-03',
    })
    journalEntryRepository.create({
      ...splitInputForSmartphone,
      lines: [...splitInputForSmartphone.lines, ...splitInputForTablet.lines],
      links: [...(splitInputForSmartphone.links ?? []), ...(splitInputForTablet.links ?? [])],
    })

    renderScreen()

    expect(await screen.findByText('2件の支出')).toBeInTheDocument()
  })

  it('資産側・負債側の両方が精算済みの割勘は、精算済みと表示する', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalEntryId: originalEntry.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        projectId: project.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        targetEntryId: splitEntry.id,
        settlementAccountId: advanceLiability.id,
        settlementAccountCategory: 'liability',
        counterAccountId: cash.id,
        amount: 500,
        householdMemberId: other.id,
        projectId: project.id,
        entryDate: '2026-08-10',
      }),
    )
    journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        targetEntryId: splitEntry.id,
        settlementAccountId: advanceAsset.id,
        settlementAccountCategory: 'asset',
        counterAccountId: cash.id,
        amount: 500,
        householdMemberId: member.id,
        projectId: project.id,
        entryDate: '2026-08-11',
      }),
    )

    renderScreen()

    expect(await screen.findByText('スーパーで食材購入')).toBeInTheDocument()
    expect(screen.getByText('精算済み')).toBeInTheDocument()
  })

  it('一覧の行から詳細を見るボタンを押すと、対象の割勘仕訳でonSelectEntryが呼ばれる', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalEntryId: originalEntry.id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        projectId: project.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )

    const { onSelectEntry } = renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))

    expect(onSelectEntry).toHaveBeenCalledTimes(1)
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ id: splitEntry.id }))
  })
})
