// @vitest-environment jsdom
/**
 * CounterpartyMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「取引先」タブ: 既定の科目の列とキーワード件数の表示、右パネルでの既定の科目の変更、
 * 登録済みキーワードの追加・編集・削除(現行の取引先管理画面から引き継ぐ)、チェックした取引先の
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
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { CounterpartyMasterTab } from './CounterpartyMasterTab'

let db: Database
let counterparties: SqlJsCounterpartyRepository
let rules: SqlJsKeywordRuleRepository
let accounts: SqlJsAccountRepository
let expenseId: number
let cashId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  rules = new SqlJsKeywordRuleRepository(db)
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
        keywordRuleRepository={rules}
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
  it('「すべての取引先」の下に取引先が並び、キーワードの件数が表示される(既定の科目の列は無い)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id, accountId: expenseId })
    rules.create({ pattern: 'ｲｵﾝ', counterpartyId: aeon.id })

    renderTab()

    expect(await screen.findByText('すべての取引先')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'イオン' })).toBeInTheDocument()
    expect(screen.getByText('2件', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '既定の科目' })).not.toBeInTheDocument()
  })

  it('右パネルに「既定の科目」の欄は無く、キーワードごとに科目を選べる(計画Issue #219)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    expect(panel('取引先の編集').queryByLabelText('既定の科目')).not.toBeInTheDocument()
    expect(panel('取引先の編集').getByLabelText('イオンの科目')).toBeInTheDocument()
  })

  it('キーワードの科目を選ぶと、そのルールだけに、すぐDBへ反映される(同じ取引先の別のキーワードは変わらない)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const first = rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    const second = rules.create({ pattern: 'AEON', counterpartyId: aeon.id, accountId: expenseId })
    renderTab()
    await open('イオン')

    fireEvent.change(panel('取引先の編集').getByLabelText('イオンの科目'), { target: { value: String(expenseId) } })

    await waitFor(() => expect(rules.findById(first.id)!.accountId).toBe(expenseId))
    expect(rules.findById(second.id)!.accountId).toBe(expenseId)
  })

  it('科目の選択肢は、費用・収益の科目だけである(取引先を持てるため)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    const select = panel('取引先の編集').getByLabelText('イオンの科目')

    expect(within(select).getByRole('option', { name: '食費' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: '現金' })).not.toBeInTheDocument()
  })

  it('キーワードの入力欄・科目の欄は、「キーワードを追加」を押すまで出ない。キャンセルで閉じる(計画Issue #219)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')
    expect(panel('取引先の編集').queryByLabelText('追加するキーワード')).not.toBeInTheDocument()
    expect(panel('取引先の編集').queryByLabelText('追加するキーワードの科目')).not.toBeInTheDocument()

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'キーワードを追加' }))

    expect(panel('取引先の編集').getByLabelText('追加するキーワード')).toBeInTheDocument()
    expect(panel('取引先の編集').getByLabelText('追加するキーワードの科目')).toBeInTheDocument()
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'キャンセル' }))
    expect(panel('取引先の編集').queryByLabelText('追加するキーワード')).not.toBeInTheDocument()
    expect(panel('取引先の編集').getByRole('button', { name: 'キーワードを追加' })).toBeInTheDocument()
  })

  it('追加するキーワードに科目を選んで追加でき、その取引先と科目のルールとして保存される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'キーワードを追加' }))
    fireEvent.change(panel('取引先の編集').getByLabelText('追加するキーワード'), { target: { value: 'AEON' } })
    fireEvent.change(panel('取引先の編集').getByLabelText('追加するキーワードの科目'), { target: { value: String(expenseId) } })
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: '追加' }))

    await waitFor(() => expect(rules.findByCounterparty(aeon.id).map((r) => [r.pattern, r.accountId])).toEqual([['AEON', expenseId]]))
  })

  it('登録済みキーワードが一覧され、文字列を追加できる', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    const editor = panel('取引先の編集')
    expect(editor.getByText('イオン', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(editor.getByRole('button', { name: 'キーワードを追加' }))
    fireEvent.change(editor.getByLabelText('追加するキーワード'), { target: { value: 'AEON' } })
    fireEvent.click(editor.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(rules.findByCounterparty(aeon.id)).toHaveLength(2))
  })

  it('キーワードを編集して保存すると、DBの文字列が変わる', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const pattern = rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'イオンを編集' }))
    fireEvent.change(panel('取引先の編集').getByLabelText('キーワード'), { target: { value: 'イオンモール' } })
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'キーワードを保存' }))

    await waitFor(() =>
      expect(rules.findByCounterparty(aeon.id).find((p) => p.id === pattern.id)!.pattern).toBe(
        'イオンモール',
      ),
    )
  })

  it('追加するキーワードは正規化して保存し、正規化後に同じものは共通の検証で拒否して理由を表示する(計画Issue #219)', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'AEON', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'キーワードを追加' }))
    fireEvent.change(panel('取引先の編集').getByLabelText('追加するキーワード'), { target: { value: 'ａｅｏｎ' } })
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('同じキーワードがすでにあります')
    expect(rules.findByCounterparty(aeon.id)).toHaveLength(1)

    fireEvent.change(panel('取引先の編集').getByLabelText('追加するキーワード'), { target: { value: 'ｉｏｎ モール' } })
    fireEvent.click(panel('取引先の編集').getByRole('button', { name: '追加' }))
    await waitFor(() => expect(rules.findByCounterparty(aeon.id).map((p) => p.pattern)).toEqual(['AEON', 'IONモール']))
  })

  it('キーワードの「削除」を押すと、確認なしでDBから削除される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    rules.create({ pattern: 'イオン', counterpartyId: aeon.id })
    renderTab()
    await open('イオン')

    fireEvent.click(panel('取引先の編集').getByRole('button', { name: 'イオンを削除' }))

    await waitFor(() => expect(rules.findByCounterparty(aeon.id)).toHaveLength(0))
  })

  it('2件以上チェックすると統合の欄が出て、確認を経て統合先に統合される', async () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const aeonMall = counterparties.create({ name: 'イオンモール' })
    rules.create({ pattern: 'イオンモール', counterpartyId: aeonMall.id })
    renderTab()
    await screen.findByRole('button', { name: 'イオン' })
    expect(screen.queryByRole('region', { name: '取引先の統合' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンを選択' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンモールを選択' }))
    const merge = within(await screen.findByRole('region', { name: '取引先の統合' }))
    fireEvent.change(merge.getByLabelText('統合先'), { target: { value: String(aeon.id) } })
    fireEvent.click(merge.getByRole('button', { name: '統合する' }))
    expect(rules.findByCounterparty(aeonMall.id)).toHaveLength(1)
    fireEvent.click(await merge.findByRole('button', { name: '統合を実行' }))

    await waitFor(() =>
      expect(rules.findByCounterparty(aeon.id).map((p) => p.pattern)).toContain('イオンモール'),
    )
    expect(rules.findByCounterparty(aeonMall.id)).toHaveLength(0)
    expect(await screen.findByText(/「イオンモール」を「イオン」に統合しました/)).toBeInTheDocument()
  })

  it('2件以上チェックすると、右側の一括操作パネルに移動と統合の欄が並ぶ', async () => {
    counterparties.create({ name: 'イオン' })
    counterparties.create({ name: 'イオンモール' })
    renderTab()
    await screen.findByRole('button', { name: 'イオン' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンを選択' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'イオンモールを選択' }))

    const bulk = within(await screen.findByRole('region', { name: '一括操作' }))
    expect(bulk.getByText('2件を選択中')).toBeInTheDocument()
    expect(bulk.getByLabelText('移動先')).toBeInTheDocument()
    expect(bulk.getByRole('region', { name: '取引先の統合' })).toBeInTheDocument()
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

  it('検索欄に入れた文字列で、名称・列の値に一致する取引先だけに絞り込める(計画Issue #219)', async () => {
    counterparties.create({ name: 'イオン' })
    counterparties.create({ name: 'Amazon' })
    renderTab()
    await screen.findByRole('button', { name: 'イオン' })

    fireEvent.change(screen.getByLabelText('取引先を検索'), { target: { value: 'amazon' } })

    expect(screen.queryByRole('button', { name: 'イオン' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Amazon' })).toBeInTheDocument()
  })

  it('検索で絞り込み中は、行をドラッグできない(隠れた行を含む並び替えを防ぐ)', async () => {
    counterparties.create({ name: 'イオン' })
    counterparties.create({ name: 'Amazon' })
    renderTab()
    await screen.findByRole('button', { name: 'イオン' })

    fireEvent.change(screen.getByLabelText('取引先を検索'), { target: { value: 'amazon' } })

    expect(screen.getByRole('button', { name: 'Amazon' }).closest('tr')).toHaveAttribute('draggable', 'false')
  })
})

