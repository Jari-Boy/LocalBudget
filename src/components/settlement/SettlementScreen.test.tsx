// @vitest-environment jsdom
/**
 * 精算(立替金の消込)画面(計画Issue #40、計画Issue #133でsettlement_batches・集計方式に移行)の
 * コンポーネントテスト。精算バッチ・精算方向(受け取る/支払う、立替金の資産/負債の別)を選択すると、
 * findUnsettledSettlementBatchBalances(settlement_batch_id・科目・世帯メンバーでグルーピングした
 * 未精算残高の集計)を用いて世帯メンバーごとの未精算残高が一覧表示され、精算操作で実際の入出金
 * 口座・金額を指定して精算仕訳(2行、docs/domain/expense-splitting.md 1.3節の精算1・精算2)を
 * 起票できることを、sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして
 * 検証する。journal_entry_linksによる明示的な消込リンクは作らず、settlement_batch_idタグの
 * 付与と集計だけで未精算残高が正しく更新されることを確認する。立替金(資産/負債)科目自体は
 * seedAdvanceAccountsで自動投入された恒久的な科目を自動解決し、ユーザーには「精算方向」という
 * 2択のみを選ばせる。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { seedAdvanceAccounts } from '../../infrastructure/db/seedAdvanceAccounts'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'

import { SettlementScreen } from './SettlementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let settlementBatchRepository: SqlJsSettlementBatchRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  settlementBatchRepository = new SqlJsSettlementBatchRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <SettlementScreen
        settlementBatchRepository={settlementBatchRepository}
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => {}}
        today="2026-08-15"
      />
    </I18nextProvider>,
  )
}

/** 立替金(資産/負債)科目を自動投入し、A→Bへの500円の割勘(負債側立替金はBさん)を1件作成する */
function setUpSplitEntry() {
  seedAdvanceAccounts(db)
  const advanceAsset = accountRepository.findAll().find((a) => a.category === 'asset' && a.isSystemManaged)!
  const advanceLiability = accountRepository
    .findAll()
    .find((a) => a.category === 'liability' && a.isSystemManaged)!
  const memberA = householdMemberRepository.create({ name: 'Aさん' })
  const memberB = householdMemberRepository.create({ name: 'Bさん' })
  const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
  const cashA = accountRepository.create({ category: 'asset', name: '現金(A)', isReconcilable: false })
  const cashB = accountRepository.create({ category: 'asset', name: '現金(B)', isReconcilable: false })
  const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
  const original = journalEntryRepository.create({
    entryDate: '2026-07-01',
    memo: '食事代',
    householdMemberId: memberA.id,
    lines: [
      { accountId: expense.id, side: 'debit', amount: 1000 },
      { accountId: cashA.id, side: 'credit', amount: 1000 },
    ],
  })
  const splitInput = buildHouseholdMemberExpenseSplittingJournalEntryInput({
    originalLineId: original.lines[0].id,
    expenseAccountId: expense.id,
    advanceAssetAccountId: advanceAsset.id,
    advanceLiabilityAccountId: advanceLiability.id,
    fromMemberId: memberA.id,
    toMemberId: memberB.id,
    settlementBatchId: batch.id,
    amount: 500,
    entryDate: '2026-07-15',
    memo: '割勘',
  })
  const splitEntry = journalEntryRepository.create(splitInput)
  return { memberA, memberB, advanceAsset, advanceLiability, cashB, batch, splitEntry }
}

async function selectBatchAndSide(batchId: number, side: 'asset' | 'liability') {
  await screen.findByLabelText('プロジェクト')
  fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(batchId) } })
  fireEvent.change(screen.getByLabelText('精算方向'), { target: { value: side } })
}

describe('SettlementScreen', () => {
  it('精算バッチ・精算方向を選択すると、未精算の世帯メンバーが残高とともに一覧表示される', async () => {
    const { memberB, batch } = setUpSplitEntry()

    renderScreen()
    // 割勘の相手(Bさん)側なので、支払う(負債側の立替金)を選ぶ
    await selectBatchAndSide(batch.id, 'liability')

    const item = (await screen.findByText(memberB.name)).closest('li')!
    expect(item).toHaveTextContent('￥500')
  })

  it('精算するボタンを押すと精算入力欄が展開し、確定すると精算仕訳が作成され一覧から消える', async () => {
    const { memberB, cashB, batch } = setUpSplitEntry()

    renderScreen()
    await selectBatchAndSide(batch.id, 'liability')
    const item = (await screen.findByText(memberB.name)).closest('li') as HTMLElement

    fireEvent.click(within(item).getByRole('button', { name: '精算する' }))
    fireEvent.change(within(item).getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.change(within(item).getByLabelText('精算金額'), { target: { value: '500' } })
    fireEvent.click(within(item).getByRole('button', { name: '精算を確定する' }))

    await waitFor(() => expect(screen.queryByText(memberB.name)).not.toBeInTheDocument())
    const settlementEntries = journalEntryRepository
      .findAll()
      .filter((entry) => entry.lines.some((line) => line.accountId === cashB.id))
    expect(settlementEntries).toHaveLength(1)
    expect(settlementEntries[0].lines).toHaveLength(2)
    expect(settlementEntries[0].lines.find((line) => line.accountId !== cashB.id)).toMatchObject({
      settlementBatchId: batch.id,
      householdMemberId: memberB.id,
    })
    // 精算仕訳自体も一時勘定(立替金)行を持つため、未精算候補の絞り込みに誤って
    // 混入していないか(=一覧が完全に空になるか)を確認する(空状態メッセージの表示)
    await waitFor(() => expect(screen.getByText('未精算の割勘はありません')).toBeInTheDocument())
  })

  it('未精算の仕訳が0件の場合、空状態メッセージが表示される', async () => {
    seedAdvanceAccounts(db)
    const batch = settlementBatchRepository.create({ name: '空のバッチ', type: 'expense_splitting' })

    renderScreen()
    await selectBatchAndSide(batch.id, 'liability')

    expect(await screen.findByText('未精算の割勘はありません')).toBeInTheDocument()
  })

  it('異なる世帯メンバーの割勘仕訳が同じ精算バッチに存在する場合、独立した行として表示され、片方の精算がもう片方の残高に影響しない(計画Issue #133、集計方式でも#40の裏付けは成立する)', async () => {
    seedAdvanceAccounts(db)
    const advanceAsset = accountRepository.findAll().find((a) => a.category === 'asset' && a.isSystemManaged)!
    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const memberB = householdMemberRepository.create({ name: 'Bさん' })
    const memberC = householdMemberRepository.create({ name: 'Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cashA = accountRepository.create({ category: 'asset', name: '現金(A)', isReconcilable: false })
    const cashB = accountRepository.create({ category: 'asset', name: '現金(B)', isReconcilable: false })
    const batch = settlementBatchRepository.create({ name: '26/7旅行割勘', type: 'expense_splitting' })
    const original = journalEntryRepository.create({
      entryDate: '2026-07-01',
      memo: '旅行の食事代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 800 },
        { accountId: cashA.id, side: 'credit', amount: 800 },
      ],
    })
    // ExpenseSplittingFormが分担者(B・C)ごとに独立して作成する仕訳を模擬する
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalLineId: original.lines[0].id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: memberA.id,
        toMemberId: memberB.id,
        settlementBatchId: batch.id,
        amount: 500,
        entryDate: '2026-07-15',
      }),
    )
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        originalLineId: original.lines[0].id,
        expenseAccountId: expense.id,
        advanceAssetAccountId: advanceAsset.id,
        advanceLiabilityAccountId: advanceLiability.id,
        fromMemberId: memberA.id,
        toMemberId: memberC.id,
        settlementBatchId: batch.id,
        amount: 300,
        entryDate: '2026-07-15',
      }),
    )

    renderScreen()
    await selectBatchAndSide(batch.id, 'liability')

    // BさんとCさんがそれぞれ独立した行として表示され、金額が混同されていないことを確認する
    const memberBItem = (await screen.findByText(memberB.name)).closest('li')!
    const memberCItem = screen.getByText(memberC.name).closest('li')!
    expect(memberBItem).toHaveTextContent('￥500')
    expect(memberCItem).toHaveTextContent('￥300')

    // Bさんの分だけを精算する
    fireEvent.click(within(memberBItem).getByRole('button', { name: '精算する' }))
    fireEvent.change(within(memberBItem).getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.change(within(memberBItem).getByLabelText('精算金額'), { target: { value: '500' } })
    fireEvent.click(within(memberBItem).getByRole('button', { name: '精算を確定する' }))

    // Bさんは一覧から消えるが、Cさん(300円)は影響を受けず残り続ける
    await waitFor(() => expect(screen.queryByText(memberB.name)).not.toBeInTheDocument())
    const remainingItem = screen.getByText(memberC.name).closest('li')!
    expect(remainingItem).toHaveTextContent('￥300')
  })

  it('一部だけ精算すると、精算した金額を差し引いた未精算残高が一覧に残る(計画Issue #133: 集計方式)', async () => {
    const { memberB, cashB, batch } = setUpSplitEntry()

    renderScreen()
    await selectBatchAndSide(batch.id, 'liability')
    const item = (await screen.findByText(memberB.name)).closest('li') as HTMLElement

    fireEvent.click(within(item).getByRole('button', { name: '精算する' }))
    fireEvent.change(within(item).getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.change(within(item).getByLabelText('精算金額'), { target: { value: '200' } })
    fireEvent.click(within(item).getByRole('button', { name: '精算を確定する' }))

    await waitFor(() => expect(screen.getByText(memberB.name).closest('li')).toHaveTextContent('￥300'))
  })

  it('1件の仕訳に世帯メンバーの異なる一時勘定行が混在していても、メンバーごとに別の行として表示され、片方の精算がもう片方に影響しない(#40の制約が不要になる)', async () => {
    seedAdvanceAccounts(db)
    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const memberB = householdMemberRepository.create({ name: 'Bさん' })
    const memberC = householdMemberRepository.create({ name: 'Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cashB = accountRepository.create({ category: 'asset', name: '現金(B)', isReconcilable: false })
    const batch = settlementBatchRepository.create({ name: '26/7旅行割勘', type: 'expense_splitting' })
    // 旧設計では禁止していた、1件の仕訳にメンバーの異なる負債側の立替金行を持たせた状態
    journalEntryRepository.create({
      entryDate: '2026-07-15',
      memo: '混在した割勘',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 800 },
        {
          accountId: advanceLiability.id,
          side: 'credit',
          amount: 500,
          settlementBatchId: batch.id,
          householdMemberId: memberB.id,
        },
        {
          accountId: advanceLiability.id,
          side: 'credit',
          amount: 300,
          settlementBatchId: batch.id,
          householdMemberId: memberC.id,
        },
      ],
    })

    renderScreen()
    await selectBatchAndSide(batch.id, 'liability')

    const itemB = (await screen.findByText(memberB.name)).closest('li')!
    const itemC = screen.getByText(memberC.name).closest('li')!
    expect(itemB).toHaveTextContent('￥500')
    expect(itemC).toHaveTextContent('￥300')

    // 500円の行(Bさん)だけを精算する
    fireEvent.click(within(itemB).getByRole('button', { name: '精算する' }))
    fireEvent.change(within(itemB).getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.change(within(itemB).getByLabelText('精算金額'), { target: { value: '500' } })
    fireEvent.click(within(itemB).getByRole('button', { name: '精算を確定する' }))

    await waitFor(() => expect(screen.queryByText(memberB.name)).not.toBeInTheDocument())
    expect(screen.getByText(memberC.name).closest('li')).toHaveTextContent('￥300')
  })

  it('戻るボタンが表示される', async () => {
    renderScreen()
    expect(await screen.findByRole('button', { name: '戻る' })).toBeInTheDocument()
  })
})
