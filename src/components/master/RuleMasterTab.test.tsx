// @vitest-environment jsdom
/**
 * RuleMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「定期取引」タブ: 名称・借方→貸方・繰り返し・金額・次回・状態の一覧、右パネルでの
 * ルールの作成と編集(科目などは選択ツリーで選ぶ、繰り返しに応じて入力欄が切り替わる)、
 * 無効化、2回押しの削除と、生成済みの仕訳があるルールの削除不可の理由表示を、sql.jsの
 * Node実装(createTestDatabase)を使って確認する。再有効化はRepositoryに手段が無いため扱わない。
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
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { RuleMasterTab } from './RuleMasterTab'

let db: Database
let rules: SqlJsRecurringTransactionRuleRepository
let expenseId: number
let cashId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  rules = new SqlJsRecurringTransactionRuleRepository(db)
  const accounts = new SqlJsAccountRepository(db)
  expenseId = accounts.create({ category: 'expense', name: '家賃', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: false }).id
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <RuleMasterTab
        recurringTransactionRuleRepository={rules}
        accountRepository={new SqlJsAccountRepository(db)}
        accountGroupRepository={new SqlJsAccountGroupRepository(db)}
        counterpartyRepository={new SqlJsCounterpartyRepository(db)}
        counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
        projectRepository={new SqlJsProjectRepository(db)}
        projectGroupRepository={new SqlJsProjectGroupRepository(db)}
        householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
        today="2026-11-07"
      />
    </I18nextProvider>,
  )
}

function makeRule(overrides: Partial<Parameters<typeof rules.create>[0]> = {}) {
  return rules.create({
    name: '家賃',
    debitAccountId: expenseId,
    creditAccountId: cashId,
    amount: 98000,
    frequency: 'monthly',
    dayOfMonth: 27,
    ...overrides,
  })
}

const panel = (name: string) => within(screen.getByRole('region', { name }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

/** 選択ツリーを開いて項目を選ぶ */
function pick(scope: ReturnType<typeof within>, label: string, item: string) {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

describe('RuleMasterTab', () => {
  it('一覧に、名称・借方→貸方・繰り返し・金額・次回・状態が表示される', async () => {
    makeRule()

    renderTab()

    const row = (await screen.findByRole('button', { name: '家賃' })).closest('tr')!
    expect(within(row).getByText('家賃 → 楽天銀行')).toBeInTheDocument()
    expect(within(row).getByText('毎月27日')).toBeInTheDocument()
    expect(within(row).getByText('¥98,000')).toBeInTheDocument()
    expect(within(row).getByText('2026/11/27')).toBeInTheDocument()
    expect(within(row).getByText('有効')).toBeInTheDocument()
  })

  it('無効なルールは、次回が「-」で、状態が無効になる', async () => {
    rules.deactivate(makeRule().id)

    renderTab()

    const row = (await screen.findByRole('button', { name: '家賃' })).closest('tr')!
    expect(within(row).getByText('無効')).toBeInTheDocument()
    expect(within(row).getByText('-')).toBeInTheDocument()
  })

  it('「定期取引を追加」で作成フォームが開き、必須項目を入れて登録するとルールが作られる', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')
    expect(form.getByRole('button', { name: '登録' })).toBeDisabled()

    fireEvent.change(form.getByLabelText('名称'), { target: { value: '家賃' } })
    pick(form, '借方の科目', '家賃')
    pick(form, '貸方の科目', '楽天銀行')
    fireEvent.change(form.getByLabelText('金額'), { target: { value: '98000' } })
    fireEvent.change(form.getByLabelText('日'), { target: { value: '27' } })
    fireEvent.click(form.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(rules.findAll()).toHaveLength(1))
    expect(rules.findAll()[0]).toMatchObject({
      name: '家賃',
      debitAccountId: expenseId,
      creditAccountId: cashId,
      amount: 98000,
      frequency: 'monthly',
      dayOfMonth: 27,
    })
  })

  it('繰り返しを毎週にすると曜日の欄が出て、日の欄が消える', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')
    expect(form.getByLabelText('日')).toBeInTheDocument()

    fireEvent.change(form.getByLabelText('繰り返し'), { target: { value: 'weekly' } })

    expect(form.getByLabelText('曜日')).toBeInTheDocument()
    expect(form.queryByLabelText('日')).not.toBeInTheDocument()
  })

  it('毎月で指定方法を「第N曜日」にすると、週と曜日の欄が出る', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')

    fireEvent.change(form.getByLabelText('指定方法'), { target: { value: 'weekday' } })

    expect(form.getByLabelText('週')).toBeInTheDocument()
    expect(form.getByLabelText('曜日')).toBeInTheDocument()
    expect(form.queryByLabelText('日')).not.toBeInTheDocument()
  })

  it('借方か貸方に費用・収益の科目を選んだときだけ、取引先の欄が出る', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')
    expect(form.queryByRole('button', { name: /^取引先/ })).not.toBeInTheDocument()

    pick(form, '借方の科目', '家賃')

    expect(form.getByRole('button', { name: /^取引先/ })).toBeInTheDocument()
  })

  it('ルールを選ぶと編集パネルに現在の値が入り、金額を変えて保存するとDBに反映される', async () => {
    const rule = makeRule()
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')
    expect(editor.getByLabelText('金額')).toHaveValue('98000')
    fireEvent.change(editor.getByLabelText('金額'), { target: { value: '100000' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(rules.findById(rule.id)!.amount).toBe(100000))
  })

  it('回数の上限と世帯メンバーを設定して保存できる', async () => {
    const rule = makeRule()
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')
    fireEvent.change(editor.getByLabelText('回数の上限'), { target: { value: '12' } })
    fireEvent.change(editor.getByLabelText('世帯メンバー'), { target: { value: String(memberId) } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(rules.findById(rule.id)!.maxOccurrences).toBe(12))
    expect(rules.findById(rule.id)!.householdMemberId).toBe(memberId)
  })

  it('「無効にする」と、ルールが無効になり、「有効にする」の操作は出ない', async () => {
    const rule = makeRule()
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '無効にする' }))

    await waitFor(() => expect(rules.findById(rule.id)!.isActive).toBe(false))
    await waitFor(() =>
      expect(panel('定期取引の編集').queryByRole('button', { name: '無効にする' })).not.toBeInTheDocument(),
    )
    expect(panel('定期取引の編集').queryByRole('button', { name: '有効にする' })).not.toBeInTheDocument()
  })

  it('生成済みの仕訳がないルールは、「削除」を2回押すと削除される', async () => {
    const rule = makeRule()
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '削除' }))
    expect(rules.findById(rule.id)).not.toBeNull()
    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(rules.findById(rule.id)).toBeNull())
  })

  it('生成済みの仕訳があるルールは、削除ボタンが押せず、理由が表示される', async () => {
    const rule = makeRule()
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-10-27',
      sourceType: 'recurring_generated',
      generatedFromRuleId: rule.id,
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 98000 },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 98000 },
      ],
    })
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')

    expect(editor.getByRole('button', { name: '削除' })).toBeDisabled()
    expect(editor.getByText(/生成済みの仕訳1件で使用中のため削除できません/)).toBeInTheDocument()
  })
})
