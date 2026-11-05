// @vitest-environment jsdom
/**
 * 精算画面(計画Issue #40、計画Issue #133でsettlement_batches・集計方式に移行、計画Issue #139で
 * 操作モデルを全面刷新)のコンポーネントテスト。
 *
 * 計画Issue #139により、旧来の「精算バッチ・精算方向を選ぶ→精算額を入力して新規仕訳を作成する」
 * 操作モデルは完全に廃止された。新しい操作モデルは「対象者(世帯メンバー or 取引先)・科目
 * (立替金/未払金)を選ぶ→未精算バッチの一覧(バッチ単位の残高)を見る→消込む既存仕訳を選ぶ→
 * 金額の一致/不一致に応じて精算完了・未精算として残す・差額損益計上を選ぶ」という、既存仕訳を
 * 選んでsettlement_batch_idを割り当てる形になっている。候補仕訳が存在しない場合のみ、新規仕訳を
 * 手動作成できる。
 *
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして、上記の操作モデル
 * 全体(バッチ一覧表示・候補仕訳の絞り込み・一致時のタグ付け・不一致時の2択・差額の損益計上・
 * 取引先が対象者の場合・候補仕訳が無い場合の手動作成)を検証する。外部依存: sql.js
 * (ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { seedAdvanceAccounts } from '../../infrastructure/db/seedAdvanceAccounts'
import { seedSettlementAdjustmentAccounts } from '../../infrastructure/db/seedSettlementAdjustmentAccounts'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsJournalEntryLinkGroupRepository } from '../../infrastructure/db/SqlJsJournalEntryLinkGroupRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'

import { SettlementScreen } from './SettlementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let settlementBatchRepository: SqlJsSettlementBatchRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let journalEntryLinkGroupRepository: SqlJsJournalEntryLinkGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  settlementBatchRepository = new SqlJsSettlementBatchRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  journalEntryLinkGroupRepository = new SqlJsJournalEntryLinkGroupRepository(db)
  seedAdvanceAccounts(db)
  seedSettlementAdjustmentAccounts(db)
})

afterEach(cleanup)

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <SettlementScreen
        settlementBatchRepository={settlementBatchRepository}
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        journalEntryRepository={journalEntryRepository}
        journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
        onBack={() => {}}
        today="2026-08-15"
      />
    </I18nextProvider>,
  )
}

function advanceAccounts() {
  const accounts = accountRepository.findAll()
  return {
    asset: accounts.find((a) => a.category === 'asset' && a.isSystemManaged)!,
    liability: accounts.find((a) => a.category === 'liability' && a.isSystemManaged)!,
  }
}

/** Aさんが立て替えてBさんが負う500円の割勘(負債側立替金、settlementBatchId付きで起票済み)を1件作成する */
function setUpHouseholdMemberBatch(amount = 500) {
  const { asset, liability } = advanceAccounts()
  const memberA = householdMemberRepository.create({ name: 'Aさん' })
  const memberB = householdMemberRepository.create({ name: 'Bさん' })
  const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
  const cashB = accountRepository.create({ category: 'asset', name: '現金(B)', isReconcilable: false })
  const batch = settlementBatchRepository.create({ name: '6月生活費', type: 'expense_splitting' })
  journalEntryRepository.create(
    buildHouseholdMemberExpenseSplittingJournalEntryInput({
      expenseAccountId: expense.id,
      advanceAssetAccountId: asset.id,
      advanceLiabilityAccountId: liability.id,
      fromMemberId: memberA.id,
      toMemberId: memberB.id,
      settlementBatchId: batch.id,
      amount,
      entryDate: '2026-07-15',
      memo: '生活費の割勘',
    }),
  )
  return { memberA, memberB, asset, liability, cashB, batch, expense }
}

/** liability科目で、settlement_batch_id未設定(未割当)のBさん向け返済仕訳を1件作成する */
function createCandidateEntry(liabilityAccountId: number, memberId: number, cashAccountId: number, amount: number) {
  return journalEntryRepository.create({
    entryDate: '2026-08-01',
    memo: 'Bさんからの返済',
    householdMemberId: memberId,
    lines: [
      { accountId: liabilityAccountId, side: 'debit', amount, householdMemberId: memberId },
      { accountId: cashAccountId, side: 'credit', amount },
    ],
  })
}

async function selectTargetAndSide(targetLabel: string, sideLabel: string) {
  await screen.findByLabelText('対象者')
  fireEvent.change(screen.getByLabelText('対象者'), { target: { value: targetLabel } })
  fireEvent.change(screen.getByLabelText('科目'), { target: { value: sideLabel } })
}

describe('SettlementScreen', () => {
  it('対象者(世帯メンバー)・科目を選択すると、未精算バッチがバッチ名・残高とともに一覧表示される', async () => {
    const { memberB, batch } = setUpHouseholdMemberBatch(500)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')

    const row = (await screen.findByText(batch.name)).closest('tr')!
    expect(row).toHaveTextContent('￥500')
  })

  it('「消込む仕訳を選ぶ」を押すと、未割当の候補仕訳がチェックボックス付きで一覧表示される', async () => {
    const { memberB, liability, cashB } = setUpHouseholdMemberBatch(500)
    const candidate = createCandidateEntry(liability.id, memberB.id, cashB.id, 500)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))

    expect(await screen.findByLabelText(`${candidate.memo}を選択する`)).toBeInTheDocument()
  })

  it('選択した仕訳の合計がバッチ残高と一致すると「精算完了」ボタンのみ表示され、確定すると対象行にsettlement_batch_idが割り当てられ一覧から消える', async () => {
    const { memberB, liability, cashB, batch } = setUpHouseholdMemberBatch(500)
    const candidate = createCandidateEntry(liability.id, memberB.id, cashB.id, 500)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))
    fireEvent.click(await screen.findByLabelText(`${candidate.memo}を選択する`))

    expect(await screen.findByText(/一致しています/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未精算として残す' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(screen.queryByText(batch.name)).not.toBeInTheDocument())
    const updatedCandidate = journalEntryRepository.findById(candidate.id)!
    expect(updatedCandidate.lines.find((l) => l.accountId === liability.id)?.settlementBatchId).toBe(batch.id)
  })

  it('選択した仕訳の合計がバッチ残高と不一致の場合、差額と2つのボタン(未精算として残す/精算完了)が表示される', async () => {
    const { memberB, liability, cashB } = setUpHouseholdMemberBatch(500)
    const candidate = createCandidateEntry(liability.id, memberB.id, cashB.id, 300)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))
    fireEvent.click(await screen.findByLabelText(`${candidate.memo}を選択する`))

    expect(await screen.findByText(/不一致/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '未精算として残す' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '精算完了' })).toBeInTheDocument()
  })

  it('不一致時に「未精算として残す」を選ぶと、選択した仕訳だけタグ付けされ差額がバッチ残高として残る', async () => {
    const { memberB, liability, cashB, batch } = setUpHouseholdMemberBatch(500)
    const candidate = createCandidateEntry(liability.id, memberB.id, cashB.id, 300)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))
    fireEvent.click(await screen.findByLabelText(`${candidate.memo}を選択する`))
    fireEvent.click(await screen.findByRole('button', { name: '未精算として残す' }))

    await waitFor(() => {
      const row = screen.getByText(batch.name).closest('tr')!
      expect(row).toHaveTextContent('￥200')
    })
    const updatedCandidate = journalEntryRepository.findById(candidate.id)!
    expect(updatedCandidate.lines.find((l) => l.accountId === liability.id)?.settlementBatchId).toBe(batch.id)
    // 調整仕訳(雑収入/雑損失)は作成されない
    const adjustmentEntries = journalEntryRepository
      .findAll()
      .filter((entry) => entry.lines.some((line) => accountRepository.findById(line.accountId)?.name === '雑損失'))
    expect(adjustmentEntries).toHaveLength(0)
  })

  it('不一致時に「精算完了」を選ぶと、差額が雑収入として計上され調整仕訳が作成されバッチ残高が0になる(負債側で選択合計が残高より少ない=残りを免除された場合)', async () => {
    const { memberB, liability, cashB, batch } = setUpHouseholdMemberBatch(500)
    const candidate = createCandidateEntry(liability.id, memberB.id, cashB.id, 300)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))
    fireEvent.click(await screen.findByLabelText(`${candidate.memo}を選択する`))
    fireEvent.click(await screen.findByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(screen.queryByText(batch.name)).not.toBeInTheDocument())
    const gainAccount = accountRepository.findAll().find((a) => a.name === '雑収入')!
    const adjustmentEntry = journalEntryRepository
      .findAll()
      .find((entry) => entry.lines.some((line) => line.accountId === gainAccount.id))
    expect(adjustmentEntry).toBeDefined()
    const gainLine = adjustmentEntry!.lines.find((l) => l.accountId === gainAccount.id)!
    expect(gainLine.side).toBe('credit')
    expect(gainLine.amount).toBe(200)
    const advanceLine = adjustmentEntry!.lines.find((l) => l.accountId === liability.id)!
    expect(advanceLine).toMatchObject({ settlementBatchId: batch.id, side: 'debit', amount: 200 })
  })

  it('候補仕訳が0件の場合、手動で仕訳を作成するボタンが表示され、初期金額がバッチ残高になっており、作成するとバッチにタグ付けされる', async () => {
    const { memberB, liability, cashB, batch } = setUpHouseholdMemberBatch(500)

    renderScreen()
    await selectTargetAndSide(`member:${memberB.id}`, 'liability')
    fireEvent.click(await screen.findByRole('button', { name: '消込む仕訳を選ぶ' }))

    expect(await screen.findByText('該当する仕訳が見当たりません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '手動で仕訳を作成する' }))
    expect(screen.getByLabelText('金額')).toHaveValue(500)
    fireEvent.change(screen.getByLabelText('精算元/精算先の口座'), { target: { value: String(cashB.id) } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(screen.queryByText(batch.name)).not.toBeInTheDocument())
    const manualEntries = journalEntryRepository
      .findAll()
      .filter((entry) => entry.lines.some((line) => line.accountId === liability.id && line.settlementBatchId === batch.id))
    expect(manualEntries.length).toBeGreaterThan(0)
    const manualLine = manualEntries[0]!.lines.find((line) => line.accountId === liability.id)!
    expect(manualLine.amount).toBe(500)
  })

  it('取引先が対象者の場合、settlement_batches.counterparty_idが一致するバッチが一覧表示される', async () => {
    const { liability } = advanceAccounts()
    const member = householdMemberRepository.create({ name: '自分' })
    const counterparty = counterpartyRepository.create({ name: 'イオン' })
    const expense = accountRepository.create({ category: 'expense', name: '日用品費', isReconcilable: null })
    const batch = settlementBatchRepository.create({
      name: 'イオンの後払い分',
      type: 'installment',
      counterpartyId: counterparty.id,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-20',
      memo: 'イオンでの買い物',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 4000 },
        { accountId: liability.id, side: 'credit', amount: 4000, householdMemberId: member.id, settlementBatchId: batch.id },
      ],
    })

    renderScreen()
    await selectTargetAndSide(`counterparty:${counterparty.id}`, 'liability')

    const row = (await screen.findByText(batch.name)).closest('tr')!
    expect(row).toHaveTextContent('￥4,000')
  })

  it('戻るボタンが表示される', async () => {
    renderScreen()
    expect(await screen.findByRole('button', { name: '戻る' })).toBeInTheDocument()
  })
})
