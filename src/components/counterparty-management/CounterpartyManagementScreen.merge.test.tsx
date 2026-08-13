// @vitest-environment jsdom
/**
 * 取引先管理画面(計画Issue #38)の取引先統合のコンポーネントテスト。
 * docs/domain/counterparties.md 1.5a節の通り、統合元(複数選択可)を選択し統合先を
 * 指定して実行すると、確認を経た上で仕訳明細・パターンが統合先へ付け替わり、
 * 統合結果(対象取引先名)が画面上に表示されることを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 一覧の取引先名は統合先セレクトの選択肢(<option>)としても同じテキストで
 * 出現するため、一覧内の要素取得は<ul role="list">配下に絞り込んで曖昧一致を避ける。
 * 外部依存: sql.js(ネットワークアクセスなし)。
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
import { CounterpartyManagementScreen } from './CounterpartyManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyManagementScreen
        counterpartyRepository={counterpartyRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

/** 一覧(<ul>)配下に絞り込んで取引先名からli要素を取得する(統合先<select>の同名<option>との曖昧一致を避ける) */
function findListItem(name: string) {
  return within(screen.getByRole('list')).getByText(name).closest('li')!
}

describe('CounterpartyManagementScreen 取引先統合', () => {
  it('統合元を選択し統合先を指定して実行すると、確認を経て統合が行われ結果が表示される', async () => {
    counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    counterpartyRepository.create({ name: 'ローソン 大阪梅田店' })
    counterpartyRepository.create({ name: 'ローソン' })

    renderScreen()
    await screen.findByRole('list')

    fireEvent.click(within(findListItem('ローソン 東京日本橋店')).getByRole('checkbox'))
    fireEvent.click(within(findListItem('ローソン 大阪梅田店')).getByRole('checkbox'))

    fireEvent.change(screen.getByLabelText('統合先'), {
      target: { value: String(counterpartyRepository.findAll().find((c) => c.name === 'ローソン')!.id) },
    })
    fireEvent.click(screen.getByRole('button', { name: '統合を実行' }))
    fireEvent.click(screen.getByRole('button', { name: '統合を確定' }))

    await waitFor(() => expect(screen.getByRole('status', { name: '統合結果' })).toBeInTheDocument())
    const result = screen.getByRole('status', { name: '統合結果' })
    expect(result).toHaveTextContent('ローソン')
    expect(result).toHaveTextContent('ローソン 東京日本橋店')
    expect(result).toHaveTextContent('ローソン 大阪梅田店')
  })

  it('統合元に紐づく仕訳明細・パターンが統合先へ付け替わる', async () => {
    const expenseAccount = accountRepository.create({
      category: 'expense',
      name: '食費',
      isReconcilable: null,
    })
    const cashAccount = accountRepository.create({
      category: 'asset',
      name: '現金',
      isReconcilable: false,
    })
    const source = counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    const target = counterpartyRepository.create({ name: 'ローソン' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-11',
      lines: [
        { accountId: expenseAccount.id, side: 'debit', amount: 500, counterpartyId: source.id },
        { accountId: cashAccount.id, side: 'credit', amount: 500 },
      ],
    })
    counterpartyRepository.addPattern(source.id, 'ローソン東京日本橋')

    renderScreen()
    await screen.findByRole('list')

    fireEvent.click(within(findListItem('ローソン 東京日本橋店')).getByRole('checkbox'))

    fireEvent.change(screen.getByLabelText('統合先'), { target: { value: String(target.id) } })
    fireEvent.click(screen.getByRole('button', { name: '統合を実行' }))
    fireEvent.click(screen.getByRole('button', { name: '統合を確定' }))

    await waitFor(() => expect(screen.getByRole('status', { name: '統合結果' })).toBeInTheDocument())

    const patterns = counterpartyRepository.findByPattern('ローソン東京日本橋')
    expect(patterns).toHaveLength(1)
    expect(patterns[0].counterpartyId).toBe(target.id)

    const [entry] = journalEntryRepository.findAll()
    const movedLine = entry.lines.find((line) => line.accountId === expenseAccount.id)!
    expect(movedLine.counterpartyId).toBe(target.id)

    // 統合先の一覧・件数表示にも付け替え後のパターンが反映される(計画Issue #85)
    const targetItem = findListItem('ローソン')
    expect(within(targetItem).getByRole('button', { name: '登録済みパターン: 1件' })).toBeInTheDocument()
    fireEvent.click(within(targetItem).getByRole('button', { name: '登録済みパターン: 1件' }))
    expect(within(targetItem).getByText('ローソン東京日本橋')).toBeInTheDocument()
  })

  it('統合先には統合元として選択したチェックボックス自身の取引先が選択肢に出ない', async () => {
    counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    counterpartyRepository.create({ name: 'ローソン' })

    renderScreen()
    await screen.findByRole('list')

    fireEvent.click(within(findListItem('ローソン 東京日本橋店')).getByRole('checkbox'))

    const targetSelect = screen.getByLabelText('統合先')
    expect(within(targetSelect).queryByText('ローソン 東京日本橋店')).not.toBeInTheDocument()
    expect(within(targetSelect).getByText('ローソン')).toBeInTheDocument()
  })

  it('統合元が未選択の場合は統合実行ボタンが無効化される', async () => {
    counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    counterpartyRepository.create({ name: 'ローソン' })

    renderScreen()
    await screen.findByRole('list')

    expect(screen.getByRole('button', { name: '統合を実行' })).toBeDisabled()
  })

  it('確認画面でキャンセルすると統合は実行されない', async () => {
    counterpartyRepository.create({ name: 'ローソン 東京日本橋店' })
    counterpartyRepository.create({ name: 'ローソン' })

    renderScreen()
    await screen.findByRole('list')

    fireEvent.click(within(findListItem('ローソン 東京日本橋店')).getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('統合先'), {
      target: { value: String(counterpartyRepository.findAll().find((c) => c.name === 'ローソン')!.id) },
    })
    fireEvent.click(screen.getByRole('button', { name: '統合を実行' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(within(screen.getByRole('list')).getByText('ローソン 東京日本橋店')).toBeInTheDocument()
  })
})
