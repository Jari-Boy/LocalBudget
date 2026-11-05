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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { SqlJsJournalEntryLinkGroupRepository } from '../../infrastructure/db/SqlJsJournalEntryLinkGroupRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { mergeExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/mergeExpenseSplittingJournalEntryInputs'
import { buildCounterpartyExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildCounterpartyExpenseSplittingJournalEntryInput'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { ExpenseSplittingHistoryScreen } from './ExpenseSplittingHistoryScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let settlementBatchRepository: SqlJsSettlementBatchRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryLinkGroupRepository: SqlJsJournalEntryLinkGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  settlementBatchRepository = new SqlJsSettlementBatchRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryLinkGroupRepository = new SqlJsJournalEntryLinkGroupRepository(db)
})

afterEach(cleanup)

function renderScreen(overrides?: { onSelectEntry?: (entry: JournalEntry) => void; onBack?: () => void }) {
  const onSelectEntry = overrides?.onSelectEntry ?? vi.fn()
  const onBack = overrides?.onBack ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExpenseSplittingHistoryScreen
        journalEntryRepository={journalEntryRepository}
        journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
        accountRepository={accountRepository}
        settlementBatchRepository={settlementBatchRepository}
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
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])

    renderScreen()

    expect(await screen.findByText('スーパーで食材購入')).toBeInTheDocument()
    expect(screen.getByText('2026-08-01')).toBeInTheDocument()
    expect(screen.queryByText('2026-08-03')).not.toBeInTheDocument()
    expect(screen.getByText('Bさん')).toBeInTheDocument()
    expect(screen.getByText('￥500')).toBeInTheDocument()
    expect(screen.getByText('未精算')).toBeInTheDocument()
    expect(screen.getByText('26/8生活費割勘')).toBeInTheDocument()
  })

  it('世帯外の相手との割勘は、取引先名を分担者として一覧表示する', async () => {
    const { advanceAsset } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const friend = counterpartyRepository.create({ name: '友人Cさん' })
    const batch = settlementBatchRepository.create({ name: '26/8旅行費割勘', type: 'expense_splitting' })
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
    const splitEntry = journalEntryRepository.create(
      buildCounterpartyExpenseSplittingJournalEntryInput({
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        payerMemberId: member.id,
        counterpartyId: friend.id,
        settlementBatchId: batch.id,
        amount: 1000,
        entryDate: '2026-08-06',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])

    renderScreen()

    expect(await screen.findByText('ホテル代')).toBeInTheDocument()
    expect(screen.getByText('友人Cさん')).toBeInTheDocument()
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、元の支出を件数でまとめて表示する', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
      expenseAccountId: expense.id,
      advanceAssetAccountId: advanceAsset.id,
      advanceLiabilityAccountId: advanceLiability.id,
      fromMemberId: member.id,
      toMemberId: other.id,
      settlementBatchId: batch.id,
      amount: 500,
      entryDate: '2026-08-03',
    })
    const splitInputForTablet = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      expenseAccountId: expense.id,
      advanceAssetAccountId: advanceAsset.id,
      advanceLiabilityAccountId: advanceLiability.id,
      fromMemberId: member.id,
      toMemberId: other.id,
      settlementBatchId: batch.id,
      amount: 250,
      entryDate: '2026-08-03',
    })
    // 本番(ExpenseSplittingForm)と同じ統合関数を使う
    const splitEntry = journalEntryRepository.create(
      mergeExpenseSplittingJournalEntryInputs({
        inputs: [splitInputForSmartphone, splitInputForTablet],
        entryDate: '2026-08-03',
        memo: null,
        householdMemberId: member.id,
      }),
    )
    // 本番(ExpenseSplittingForm)が割勘仕訳作成時に行う自動グルーピングを模擬する
    // (複数の元仕訳をまとめて1回で割勘した場合、全元仕訳+割勘仕訳が1つのグループに所属する)
    journalEntryLinkGroupRepository.createGroup([smartphoneEntry.id, tabletEntry.id, splitEntry.id])

    renderScreen()

    expect(await screen.findByText('2件の支出')).toBeInTheDocument()
    expect(screen.getByText('￥750')).toBeInTheDocument()
  })

  it('資産側・負債側の両方が精算済みの割勘は、精算済みと表示する', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])
    const settlementEntry1 = journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        settlementAccountId: advanceLiability.id,
        settlementAccountCategory: 'liability',
        counterAccountId: cash.id,
        amount: 500,
        settlementHouseholdMemberId: other.id,
        entryHouseholdMemberId: other.id,
        settlementBatchId: batch.id,
        entryDate: '2026-08-10',
      }),
    )
    const settlementEntry2 = journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        settlementAccountId: advanceAsset.id,
        settlementAccountCategory: 'asset',
        counterAccountId: cash.id,
        amount: 500,
        settlementHouseholdMemberId: member.id,
        entryHouseholdMemberId: member.id,
        settlementBatchId: batch.id,
        entryDate: '2026-08-11',
      }),
    )
    // 本番(SettlementScreen)が精算仕訳作成時に行う自動グルーピングを模擬する
    journalEntryLinkGroupRepository.joinOrCreateGroups([splitEntry.id], [settlementEntry1.id])
    journalEntryLinkGroupRepository.joinOrCreateGroups([splitEntry.id], [settlementEntry2.id])

    renderScreen()

    expect(await screen.findByText('スーパーで食材購入')).toBeInTheDocument()
    expect(screen.getByText('精算済み')).toBeInTheDocument()
  })

  it('一覧の行から詳細を見るボタンを押すと、対象の割勘仕訳でonSelectEntryが呼ばれる', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])

    const { onSelectEntry } = renderScreen()
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))

    expect(onSelectEntry).toHaveBeenCalledTimes(1)
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ id: splitEntry.id }))
  })

  it('精算前の割勘には取り消し(物理削除)ボタンが表示され、押すと削除され一覧から消える(計画Issue #139、仕訳詳細画面から本画面へ取り消し導線を移設)', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])

    renderScreen()
    const row = (await screen.findByText('スーパーで食材購入')).closest('li')!

    fireEvent.click(within(row).getByRole('button', { name: 'この割勘を取り消す' }))

    await waitFor(() => expect(screen.queryByText('スーパーで食材購入')).not.toBeInTheDocument())
    expect(journalEntryRepository.findById(splitEntry.id)).toBeNull()
  })

  it('精算済みの割勘には取り消しボタンの代わりに返金案内メッセージが表示される(計画Issue #139)', async () => {
    const { advanceAsset, advanceLiability } = setUpAdvanceAccounts()
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/8生活費割勘', type: 'expense_splitting' })
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
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: member.id,
        toMemberId: other.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-08-03',
      }),
    )
    journalEntryLinkGroupRepository.createGroup([originalEntry.id, splitEntry.id])
    // 実際の精算画面と同じ形: 立替金(負債)行に同じbatch.id・householdMemberIdをタグ付けするだけ
    journalEntryRepository.create(
      buildSettlementJournalEntryInput({
        settlementBatchId: batch.id,
        settlementAccountId: advanceLiability.id,
        settlementAccountCategory: 'liability',
        counterAccountId: cash.id,
        amount: 500,
        settlementHouseholdMemberId: other.id,
        entryHouseholdMemberId: other.id,
        entryDate: '2026-08-10',
      }),
    )

    renderScreen()
    const row = (await screen.findByText('スーパーで食材購入')).closest('li')!

    expect(await within(row).findByText('精算後は新しい取引として現実の返金を記録してください')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'この割勘を取り消す' })).not.toBeInTheDocument()
  })
})
