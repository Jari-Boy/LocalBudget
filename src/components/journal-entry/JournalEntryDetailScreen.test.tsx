// @vitest-environment jsdom
/**
 * 確定済み仕訳詳細画面(計画Issue #40、Lines編集は計画Issue #125)のコンポーネントテスト。
 * 個々の仕訳明細(科目名・金額・プロジェクト・世帯メンバー・取引先)を共通コンポーネント
 * JournalEntryLinesTableで編集可能なカード形式(借方・貸方ブロック)で表示すること、
 * 明細の編集・行の追加削除(行追加ボタンは廃止、ブロック最終行が入力済みになると
 * 自動で次の空行が現れる)・更新操作(JournalEntryRepository.updateの呼び出し、
 * 貸借不一致時のエラー表示と入力保持)、割勘の履歴表示(元の支出→割勘→精算のトレース、
 * docs/domain/expense-splitting.md 1.5節)、取り消し導線(精算前は割勘仕訳の物理削除、
 * 精算後は返金案内メッセージ)を、sql.jsのNode実装(createTestDatabase)を使った統合的な
 * レンダリングテストとして検証する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { JournalEntryDetailScreen } from './JournalEntryDetailScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let settlementBatchRepository: SqlJsSettlementBatchRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let journalEntryLinkGroupRepository: SqlJsJournalEntryLinkGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  settlementBatchRepository = new SqlJsSettlementBatchRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  journalEntryLinkGroupRepository = new SqlJsJournalEntryLinkGroupRepository(db)
})

afterEach(cleanup)

function renderScreen(entryId: number, overrides?: { onBack?: () => void; onDeleted?: () => void }) {
  const onBack = overrides?.onBack ?? vi.fn()
  const onDeleted = overrides?.onDeleted ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryDetailScreen
        entryId={entryId}
        journalEntryRepository={journalEntryRepository}
        journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={onBack}
        onDeleted={onDeleted}
      />
    </I18nextProvider>,
  )
  return { onBack, onDeleted }
}

/**
 * 借方列・貸方列それぞれの「実データを持つ」セルを取得する(計画Issue #125、
 * JournalEntryLinesTableは連結した1枚の表で借方/貸方を列として持つため、
 * 各tr内の該当列セル(空セルを除く)を集める)。getBlock/findBlockはside識別子を
 * そのまま返し、getCardsが呼ばれるたびにDOMを再クエリする(waitFor内での再評価や
 * 複数回の呼び出しが常に最新のセル構成を反映できるようにするため)。
 */
function getDebitOrCreditCells(side: '借方' | '貸方'): HTMLElement[] {
  const columnIndex = side === '借方' ? 0 : 1
  return Array.from(screen.getByRole('table').querySelectorAll('tbody tr'))
    .map((row) => (row as HTMLTableRowElement).cells[columnIndex])
    .filter((cell) => !cell.classList.contains('journal-entry-lines-table-cell-empty'))
}

function getBlock(side: '借方' | '貸方'): '借方' | '貸方' {
  return side
}

async function findBlock(side: '借方' | '貸方'): Promise<'借方' | '貸方'> {
  await screen.findByRole('table')
  return side
}

function getCards(side: '借方' | '貸方'): HTMLElement[] {
  return getDebitOrCreditCells(side)
}

describe('JournalEntryDetailScreen', () => {
  it('仕訳の日付・摘要・各明細行(科目・金額)がLinesテーブルに表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen(entry.id)

    expect(await screen.findByLabelText('取引日')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('摘要(任意)')).toHaveValue('スーパーで食材購入')
    // 確定済み明細(非空)が最終行のため、不変条件により各ブロックに自動で空行が1枚追加され
    // 2枚ずつカードが表示される(計画Issue #125)。useEffectでの自動追加はコミット後の
    // 追加レンダリングを挟むためwaitForで待つ。
    await waitFor(() => expect(getCards(getBlock('借方'))).toHaveLength(2))
    await waitFor(() => expect(getCards(getBlock('貸方'))).toHaveLength(2))
    const debitCards = getCards(getBlock('借方'))
    const creditCards = getCards(getBlock('貸方'))
    expect(within(debitCards[0]).getByLabelText('科目')).toHaveValue(String(expense.id))
    expect(within(debitCards[0]).getByLabelText('金額')).toHaveValue(3000)
    expect(within(creditCards[0]).getByLabelText('科目')).toHaveValue(String(cash.id))
    expect(within(creditCards[0]).getByLabelText('金額')).toHaveValue(3000)
  })

  it('明細行にプロジェクト・世帯メンバー・取引先が設定されている場合、それぞれの選択値がLinesテーブルに反映される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const project = projectRepository.create({ name: '26/7生活費割勘' })
    const counterparty = counterpartyRepository.create({ name: '友人Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '友人との食事',
      householdMemberId: member.id,
      lines: [
        { accountId: advanceAsset.id, side: 'debit', amount: 500, projectId: project.id, householdMemberId: other.id },
        { accountId: expense.id, side: 'credit', amount: 500, counterpartyId: counterparty.id },
      ],
    })

    renderScreen(entry.id)

    const debitCard = getCards(await findBlock('借方'))[0]
    const creditCard = getCards(await findBlock('貸方'))[0]
    expect(within(debitCard).getByLabelText('プロジェクト(任意)')).toHaveValue(String(project.id))
    expect(within(debitCard).getByLabelText('世帯メンバー(任意)')).toHaveValue(String(other.id))
    expect(within(creditCard).getByLabelText('取引先(任意)')).toHaveValue(String(counterparty.id))
  })

  it('明細を編集して更新すると、JournalEntryRepository.updateが呼ばれ変更が画面に反映される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen(entry.id)
    const debitCard = getCards(await findBlock('借方'))[0]
    const creditCard = getCards(await findBlock('貸方'))[0]

    fireEvent.change(within(debitCard).getByLabelText('金額'), { target: { value: '5000' } })
    fireEvent.change(within(creditCard).getByLabelText('金額'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      const updated = journalEntryRepository.findById(entry.id)
      expect(updated?.lines.map((line) => line.amount)).toEqual([5000, 5000])
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('金額・摘要を編集して更新しても、既存の明細行のidは維持される(行単位リンクを保つため、計画Issue #132)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '更新前',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })
    const originalLineIds = entry.lines.map((line) => line.id)
    // 更新対象の明細が採番の末尾だと、全削除→再挿入でも偶然同じidが再利用されてしまうため、
    // 後続の仕訳を作っておく(SqlJsJournalEntryRepository.test.tsのcreateLaterEntry参照)
    journalEntryRepository.create({
      entryDate: '2026-12-31',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1 },
        { accountId: cash.id, side: 'credit', amount: 1 },
      ],
    })

    renderScreen(entry.id)
    const debitCard = getCards(await findBlock('借方'))[0]
    const creditCard = getCards(await findBlock('貸方'))[0]

    fireEvent.change(screen.getByLabelText('摘要(任意)'), { target: { value: '更新後' } })
    fireEvent.change(within(debitCard).getByLabelText('金額'), { target: { value: '5000' } })
    fireEvent.change(within(creditCard).getByLabelText('金額'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))

    await waitFor(() => {
      expect(journalEntryRepository.findById(entry.id)?.memo).toBe('更新後')
    })
    expect(journalEntryRepository.findById(entry.id)?.lines.map((line) => line.id)).toEqual(originalLineIds)
  })

  it('更新を2回続けて行っても、最初の更新後に読み込んだ行idで差分更新できる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '1回目前',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })
    const originalLineIds = entry.lines.map((line) => line.id)
    // 更新対象の明細が採番の末尾だと、全削除→再挿入でも偶然同じidが再利用されてしまうため、
    // 後続の仕訳を作っておく(SqlJsJournalEntryRepository.test.tsのcreateLaterEntry参照)
    journalEntryRepository.create({
      entryDate: '2026-12-31',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1 },
        { accountId: cash.id, side: 'credit', amount: 1 },
      ],
    })

    renderScreen(entry.id)
    await findBlock('借方')

    fireEvent.change(screen.getByLabelText('摘要(任意)'), { target: { value: '1回目' } })
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => expect(journalEntryRepository.findById(entry.id)?.memo).toBe('1回目'))

    fireEvent.change(screen.getByLabelText('摘要(任意)'), { target: { value: '2回目' } })
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => expect(journalEntryRepository.findById(entry.id)?.memo).toBe('2回目'))

    expect(journalEntryRepository.findById(entry.id)?.lines.map((line) => line.id)).toEqual(originalLineIds)
  })

  it('貸借が不一致になる編集をして更新すると、エラーメッセージが表示され入力内容は保持されDBも更新されない', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen(entry.id)
    const debitCard = getCards(await findBlock('借方'))[0]

    fireEvent.change(within(debitCard).getByLabelText('金額'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('貸借が一致していません')
    expect(within(getCards(getBlock('借方'))[0]).getByLabelText('金額')).toHaveValue(4000)
    expect(journalEntryRepository.findById(entry.id)?.lines.map((line) => line.amount)).toEqual([3000, 3000])
  })

  it('ブロック最終行が入力済みの既存明細を読み込むと自動で空行が追加され、削除しても入力済み行が最終行である限り空行が保たれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen(entry.id)
    const debitBlock = await findBlock('借方')

    // 行追加ボタンは無く、確定済み明細(非空)が最終行のため不変条件により自動で空行が1枚追加される。
    await waitFor(() => expect(getCards(debitBlock)).toHaveLength(2))

    const removeButton = within(getCards(debitBlock)[1]).getByRole('button', { name: 'この行を削除する' })
    fireEvent.click(removeButton)

    // 入力済みの行(食費)が最終行のままのため、削除直後に再び空行が自動追加され行数は2のまま。
    await waitFor(() => expect(getCards(debitBlock)).toHaveLength(2))
    expect(within(getCards(debitBlock)[0]).getByLabelText('科目')).toHaveValue(String(expense.id))
  })

  it('割勘・精算と無関係な通常の仕訳では、取り消しセクションが表示されない', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen(entry.id)

    await screen.findByLabelText('取引日')
    expect(screen.queryByRole('button', { name: 'この割勘を取り消す' })).not.toBeInTheDocument()
  })

  it('精算前の割勘仕訳では、取り消し(物理削除)ボタンが表示され、押すと削除されonDeletedが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })

    const { onDeleted } = renderScreen(splitEntry.id)
    await screen.findByLabelText('取引日')

    const deleteButton = await screen.findByRole('button', { name: 'この割勘を取り消す' })
    fireEvent.click(deleteButton)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(journalEntryRepository.findById(splitEntry.id)).toBeNull()
  })

  it('同じ精算バッチに別の未精算の割勘仕訳が追加されただけでは、取り消し(物理削除)ボタンが表示され続ける(evaluatorレビュー指摘: hasAnySettlementActivityの回帰修正を、実際のRepository経由・JournalEntryDetailScreenの配線込みで検証する。既存バッチへ複数の割勘を追記する運用フローは正常であり、精算が行われていない限り取り消しを妨げてはならない)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代1',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry1 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘1',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })
    // 同じ精算バッチへ、もう1件別の割勘仕訳を追記する(精算画面の「既存バッチへの追記」と
    // 同じ正常な運用フロー)。どちらも未精算のまま。
    journalEntryRepository.create({
      entryDate: '2026-08-03',
      memo: '食事代2',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 300 },
        { accountId: cash.id, side: 'credit', amount: 300 },
      ],
    })
    journalEntryRepository.create({
      entryDate: '2026-08-04',
      memo: '割勘2',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 150, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 150, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 150, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 150, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })

    renderScreen(splitEntry1.id)
    await screen.findByLabelText('取引日')

    expect(await screen.findByRole('button', { name: 'この割勘を取り消す' })).toBeInTheDocument()
    expect(screen.queryByText('精算後は新しい取引として現実の返金を記録してください')).not.toBeInTheDocument()
  })

  it('精算済みの割勘仕訳では、取り消しボタンの代わりに返金案内メッセージが表示される(計画Issue #133、精算状況はsettlement_batch_idタグの集計で判定する。かつてjournal_entry_linksのsettlesリンクで判定していたが、精算画面がsettlesリンクを作らなくなったため、実際の精算フローを再現してisSettledがタグ集計方式で正しく判定できることを検証する)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })
    // 実際の精算画面(buildSettlementJournalEntryInput)と同じ形: 立替金(負債)行に
    // 同じbatch.id・householdMemberIdをタグ付けするだけで、journal_entry_linksは作らない。
    // hasAnySettlementActivityは「少なくとも1件の精算操作が行われたか」を判定するため、
    // 資産側(立替者memberの債権)・負債側(分担者otherの債務)のどちらか一方の精算だけで
    // 取り消し導線が切り替わることを検証する(実際の精算画面も1回の操作では片方向のみ
    // 精算する、docs/domain/expense-splitting.md 1.3節)。
    journalEntryRepository.create({
      entryDate: '2026-08-10',
      memo: '精算',
      householdMemberId: other.id,
      lines: [
        { accountId: advanceLiability.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderScreen(splitEntry.id)

    expect(await screen.findByText('精算後は新しい取引として現実の返金を記録してください')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この割勘を取り消す' })).not.toBeInTheDocument()
  })

  it('元の支出仕訳の詳細画面で、割勘の履歴(元の支出→割勘→精算)が表示される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })
    // 本番(ExpenseSplittingForm)が割勘仕訳作成時に行う自動グルーピングを模擬する(計画Issue #138)
    journalEntryLinkGroupRepository.createGroup([original.id, splitEntry.id])

    renderScreen(original.id)

    expect(await screen.findByText('この支出から生まれた割勘')).toBeInTheDocument()
    expect(within(screen.getByText('この支出から生まれた割勘').closest('div')!).getByText('2026-08-02')).toBeInTheDocument()
  })

  it('関連仕訳ボタンには件数が表示され、押すとダイアログが開いて関連する仕訳の行をクリックするとonSelectRelatedEntryが呼ばれる(計画Issue #138、UIレビューによりインライン表示からダイアログ方式へ変更)', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const other = householdMemberRepository.create({ name: 'Bさん' })
    const batch = settlementBatchRepository.create({ name: '26/7生活費割勘', type: 'expense_splitting' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const advanceAsset = accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const advanceLiability = accountRepository.create({
      category: 'liability',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const original = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '食事代',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const splitEntry = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '割勘',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500, householdMemberId: other.id },
        { accountId: advanceAsset.id, side: 'debit', amount: 500, settlementBatchId: batch.id, householdMemberId: member.id },
        { accountId: expense.id, side: 'credit', amount: 500, householdMemberId: member.id },
        { accountId: advanceLiability.id, side: 'credit', amount: 500, settlementBatchId: batch.id, householdMemberId: other.id },
      ],
    })
    journalEntryLinkGroupRepository.createGroup([original.id, splitEntry.id])

    const onSelectRelatedEntry = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <JournalEntryDetailScreen
          entryId={original.id}
          journalEntryRepository={journalEntryRepository}
          journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
          accountRepository={accountRepository}
          projectRepository={projectRepository}
          householdMemberRepository={householdMemberRepository}
          counterpartyRepository={counterpartyRepository}
          onBack={vi.fn()}
          onSelectRelatedEntry={onSelectRelatedEntry}
        />
      </I18nextProvider>,
    )

    const trigger = await screen.findByRole('button', { name: '関連仕訳(1件)' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('割勘').closest('button')!)

    expect(onSelectRelatedEntry).toHaveBeenCalledWith(expect.objectContaining({ id: splitEntry.id }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('関連仕訳ダイアログで候補を選ぶと、joinOrCreateGroupsが呼ばれて一覧とボタンの件数に反映される', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '対象の仕訳',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const candidate = journalEntryRepository.create({
      entryDate: '2026-08-05',
      memo: '関連付け候補',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 200 },
        { accountId: cash.id, side: 'credit', amount: 200 },
      ],
    })

    renderScreen(entry.id)

    const trigger = await screen.findByRole('button', { name: '関連仕訳(0件)' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('+ 関連仕訳を追加'))
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: String(candidate.id) } })

    await waitFor(() => {
      expect(journalEntryLinkGroupRepository.findGroupIdsForEntry(entry.id).length).toBe(1)
    })
    expect(await within(screen.getByRole('dialog')).findByText('関連付け候補')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '関連仕訳(1件)' })).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const member = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      householdMemberId: member.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onBack } = renderScreen(entry.id)
    await screen.findByLabelText('取引日')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
