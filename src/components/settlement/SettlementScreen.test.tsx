// @vitest-environment jsdom
/**
 * 精算(立替金の消込)画面(計画Issue #40)のコンポーネントテスト。割勘バッチ
 * (kind='settlement'のプロジェクト)・立替金科目を選択すると、A7消込ロジック
 * (findUnsettledEntries)を用いた未精算の仕訳一覧が表示され、精算操作で
 * 実際の入出金口座・金額を指定して精算仕訳(2行、docs/domain/expense-splitting.md
 * 1.3節の精算1・精算2)を起票できることを、sql.jsのNode実装(createTestDatabase)を
 * 使った統合的なレンダリングテストとして検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { SettlementScreen } from './SettlementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <SettlementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => {}}
        today="2026-08-15"
      />
    </I18nextProvider>,
  )
}

function setUpSplitEntry() {
  const memberA = householdMemberRepository.create({ name: 'Aさん' })
  const memberB = householdMemberRepository.create({ name: 'Bさん' })
  const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
  const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
  const advanceLiability = accountRepository.create({
    category: 'liability',
    name: '立替金',
    isReconcilable: false,
  })
  const cashB = accountRepository.create({ category: 'asset', name: '現金(B)', isReconcilable: false })
  const project = projectRepository.create({ name: '26/7生活費割勘', kind: 'settlement' })
  const original = journalEntryRepository.create({
    entryDate: '2026-07-01',
    memo: '食事代',
    householdMemberId: memberA.id,
    lines: [
      { accountId: expense.id, side: 'debit', amount: 1000 },
      { accountId: accountRepository.create({ category: 'asset', name: '現金(A)', isReconcilable: false }).id, side: 'credit', amount: 1000 },
    ],
  })
  const splitInput = buildHouseholdMemberExpenseSplittingJournalEntryInput({
    originalEntryId: original.id,
    expenseAccountId: expense.id,
    advanceAssetAccountId: advanceAsset.id,
    advanceLiabilityAccountId: advanceLiability.id,
    fromMemberId: memberA.id,
    toMemberId: memberB.id,
    projectId: project.id,
    amount: 500,
    entryDate: '2026-07-15',
    memo: '割勘',
  })
  const splitEntry = journalEntryRepository.create(splitInput)
  return { memberA, memberB, advanceAsset, advanceLiability, cashB, project, splitEntry }
}

describe('SettlementScreen', () => {
  it('割勘バッチ・立替金科目を選択すると、未精算の仕訳が一覧表示される', async () => {
    const { advanceLiability, project, splitEntry } = setUpSplitEntry()

    renderScreen()
    await screen.findByLabelText('割勘バッチ')

    fireEvent.change(screen.getByLabelText('割勘バッチ'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('立替金科目'), { target: { value: String(advanceLiability.id) } })

    const item = (await screen.findByText('割勘')).closest('li')!
    expect(item).toHaveTextContent('￥500')
    expect(item).toHaveTextContent(splitEntry.entryDate)
  })

  it('精算するボタンを押すと精算入力欄が展開し、確定すると精算仕訳が作成され一覧から消える', async () => {
    const { advanceLiability, cashB, project } = setUpSplitEntry()

    renderScreen()
    await screen.findByLabelText('割勘バッチ')
    fireEvent.change(screen.getByLabelText('割勘バッチ'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('立替金科目'), { target: { value: String(advanceLiability.id) } })
    const item = (await screen.findByText('割勘')).closest('li') as HTMLElement

    fireEvent.click(within(item).getByRole('button', { name: '精算する' }))
    fireEvent.change(within(item).getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.change(within(item).getByLabelText('精算金額'), { target: { value: '500' } })
    fireEvent.click(within(item).getByRole('button', { name: '精算を確定する' }))

    await waitFor(() => expect(screen.queryByText('割勘')).not.toBeInTheDocument())
    const settlementEntries = journalEntryRepository
      .findAll()
      .filter((entry) => entry.lines.some((line) => line.accountId === cashB.id))
    expect(settlementEntries).toHaveLength(1)
    expect(settlementEntries[0].lines).toHaveLength(2)
    // 精算仕訳自体も一時勘定(立替金)行を持つため、未精算候補の絞り込みに誤って
    // 混入していないか(=一覧が完全に空になるか)を確認する(空状態メッセージの表示)
    await waitFor(() => expect(screen.getByText('未精算の割勘はありません')).toBeInTheDocument())
  })

  it('未精算の仕訳が0件の場合、空状態メッセージが表示される', async () => {
    const project = projectRepository.create({ name: '空のバッチ', kind: 'settlement' })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
    })

    renderScreen()
    await screen.findByLabelText('割勘バッチ')
    fireEvent.change(screen.getByLabelText('割勘バッチ'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('立替金科目'), { target: { value: String(advanceLiability.id) } })

    expect(await screen.findByText('未精算の割勘はありません')).toBeInTheDocument()
  })

  it('戻るボタンが表示される', async () => {
    renderScreen()
    expect(await screen.findByRole('button', { name: '戻る' })).toBeInTheDocument()
  })
})
