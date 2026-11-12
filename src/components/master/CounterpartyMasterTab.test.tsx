// @vitest-environment jsdom
/**
 * CounterpartyMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「取引先」タブ: 既定の科目の列とパターン件数の表示、右パネルでの既定の科目の変更、
 * 登録済みパターンの追加・編集・削除(現行の取引先管理画面から引き継ぐ)、チェックした取引先の
 * 統合(現行画面から引き継ぐ)、仕訳・定期仕訳ルール・精算バッチの相手で使用中のときの
 * 削除不可の理由表示を、sql.jsのNode実装(createTestDatabase)を使って確認する。
 * ツリー表・グループ操作の共通部分はProjectMasterTab.test.tsx側で検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { CounterpartyMasterTab } from './CounterpartyMasterTab'

let db: Database
let counterparties: SqlJsCounterpartyRepository
let accounts: SqlJsAccountRepository
let expenseId: number
let cashId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  accounts = new SqlJsAccountRepository(db)
  expenseId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <CounterpartyMasterTab
        counterpartyRepository={counterparties}
        counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
        accountRepository={accounts}
        journalEntryRepository={new SqlJsJournalEntryRepository(db)}
        recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
        settlementBatchRepository={new SqlJsSettlementBatchRepository(db)}
      />
    </I18nextProvider>,
  )
}

const panel = (name: string) => within(screen.getByRole('region', { name }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('CounterpartyMasterTab', () => {
  it('「すべての取引先」の下に取引先が並び、既定の科目の列とパターンの件数が表示される', async () => {
    const aeon = counterparties.create({ name: 'イオン', defaultAccountId: expenseId })
    counterparties.addPattern(aeon.id, 'イオン')
    counterparties.addPattern(aeon.id, 'ｲｵﾝ')

    renderTab()

    expect(await screen.findByText('すべての取引先')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'イオン' })).toBeInTheDocument()
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('パターン2件')).toBeInTheDocument()
  })

  it('右パネルで既定の科目を選ぶと、すぐにDBへ反映される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    renderTab()
    await open('イオン')

    fireEvent.change(panel('取引先の編集').getByLabelText('既定の科目'), { target: { value: String(expenseId) } })

    await waitFor(() => expect(counterparties.findById(aeon.id)!.defaultAccountId).toBe(expenseId))
  })

  it('既定の科目の選択肢は、費用・収益の科目だけである', async () => {
    counterparties.create({ name: 'イオン' })
    renderTab()
    await open('イオン')

    const select = panel('取引先の編集').getByLabelText('既定の科目')

    expect(within(select).getByRole('option', { name: '食費' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: '現金' })).not.toBeInTheDocument()
  })

  it('登録済みパターンが一覧され、文字列を追加できる', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    counterparties.addPattern(aeon.id, 'イオン')
    renderTab()
    await open('イオン')

    const editor = panel('取引先の編集')
    expect(editor.getByText('イオン', { selector: 'span' })).toBeInTheDocument()
    fireEvent.change(editor.getByLabelText('追加するパターン'), { target: { value: 'AEON' } })
    fireEvent.click(editor.getByRole('button', { name: '+ パターンを追加' }))

    await waitFor(() => expect(counterparties.findPatternsByCounterparty(aeon.id)).toHaveLength(2))
  })

  it('パターンを編集して保存すると、DBの文字列が変わる', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const pattern = counterparties.addPattern(aeon.id, 'イオン')
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'イオンを編集' }))
    fireEvent.change(panel('取引先の編集').getByLabelText('パターン'), { target: { value: 'イオンモール' } })
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'パターンを保存' }))

    await waitFor(() =>
      expect(counterparties.findPatternsByCounterparty(aeon.id).find((p) => p.id === pattern.id)!.pattern).toBe(
        'イオンモール',
      ),
    )
  })

  it('パターンの「削除」を押すと、確認なしでDBから削除される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    counterparties.addPattern(aeon.id, 'イオン')
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'イオンを削除' }))

    await waitFor(() => expect(counterparties.findPatternsByCounterparty(aeon.id)).toHaveLength(0))
  })

  it('2件以上チェックすると統合の欄が出て、確認を経て統合先に統合される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const aeonMall = counterparties.create({ name: 'イオンモール' })
    counterparties.addPattern(aeonMall.id, 'イオンモール')
    renderTab()
    await screen.findByRole('button', { name: 'イオン' })
    expect(screen.queryByRole('region', { name: '取引先の統合' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンを選択' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンモールを選択' }))
    const merge = within(await screen.findByRole('region', { name: '取引先の統合' }))
    fireEvent.change(merge.getByLabelText('統合先'), { target: { value: String(aeon.id) } })
    fireEvent.click(merge.getByRole('button', { name: '統合する' }))
    expect(counterparties.findPatternsByCounterparty(aeonMall.id)).toHaveLength(1)
    fireEvent.click(await merge.findByRole('button', { name: '統合を実行' }))

    await waitFor(() =>
      expect(counterparties.findPatternsByCounterparty(aeon.id).map((p) => p.pattern)).toContain('イオンモール'),
    )
    expect(counterparties.findPatternsByCounterparty(aeonMall.id)).toHaveLength(0)
    expect(await screen.findByText(/「イオンモール」を「イオン」に統合しました/)).toBeInTheDocument()
  })

  it('仕訳で使用中の取引先は、削除できず理由が表示される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-11-01',
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 1000, counterpartyId: aeon.id },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 1000 },
      ],
    })
    renderTab()
    await open('イオン')

    const editor = panel('取引先の編集')

    expect(editor.getByRole('button', { name: '削除' })).toBeDisabled()
    expect(editor.getByText(/仕訳の明細1行で使用中のため削除できません/)).toBeInTheDocument()
  })

  it('定期仕訳ルールと精算バッチの相手で使用中の取引先も、その理由が表示される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '食費',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 1000, counterpartyId: aeon.id },
        { side: 'credit', accountId: cashId, amount: 1000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    new SqlJsSettlementBatchRepository(db).create({
      name: '10月分',
      type: 'expense_splitting',
      counterpartyId: aeon.id,
    })
    renderTab()
    await open('イオン')

    const editor = panel('取引先の編集')

    expect(editor.getByText(/定期仕訳ルール1件/)).toBeInTheDocument()
    expect(editor.getByText(/精算バッチの相手1件/)).toBeInTheDocument()
    expect(editor.getByRole('button', { name: '削除' })).toBeDisabled()
  })

  it('使われていない取引先は、「削除」を2回押すと削除される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: '削除' }))
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(counterparties.findById(aeon.id)).toBeNull())
  })
})
