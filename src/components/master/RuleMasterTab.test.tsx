// @vitest-environment jsdom
/**
 * RuleMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「定期取引」タブ: 名称・繰り返し・金額・次回・状態の一覧(科目は出さない)、右パネルでの
 * ルールの作成と編集(科目などは選択ツリーで選ぶ、繰り返しに応じて入力欄が切り替わる)、
 * 無効化、2回押しの削除と、生成済みの仕訳があるルールの削除不可の理由表示を、sql.jsの
 * Node実装(createTestDatabase)を使って確認する。計画Issue #164で追加した、開始日・終了日・間隔・
 * 土日の調整・金額の初期値の入力と保存、これからの期日のプレビュー、仕訳エディタと同じ借方・貸方の
 * 2列(ルールの表で持てない項目は無効表示)、状態「終了」、再有効化(再開日の選択、終了したルールには
 * 出さない)も確認する。登録・保存などに失敗したときのエラーは、右パネルの操作ボタンの直上に、
 * 失敗の原因とあわせて表示することも確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
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

function renderTab(ruleRepository: ComponentProps<typeof RuleMasterTab>['recurringTransactionRuleRepository'] = rules) {
  render(
    <I18nextProvider i18n={i18n}>
      <RuleMasterTab
        recurringTransactionRuleRepository={ruleRepository}
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
    startsOn: '2026-01-01',
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
  it('一覧に、名称・繰り返し・金額・次回・状態が表示され、科目(借方・貸方)は表示されない', async () => {
    makeRule()

    renderTab()

    const row = (await screen.findByRole('button', { name: '家賃' })).closest('tr')!
    expect(within(row).queryByText(/楽天銀行/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/→/)).not.toBeInTheDocument()
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
    fireEvent.change(editor.getByLabelText('起票者'), { target: { value: String(memberId) } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(rules.findById(rule.id)!.maxOccurrences).toBe(12))
    expect(rules.findById(rule.id)!.householdMemberId).toBe(memberId)
  })

  it('「無効にする」と、ルールが無効になり、ボタンが「有効にする」に変わる', async () => {
    const rule = makeRule()
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '無効にする' }))

    await waitFor(() => expect(rules.findById(rule.id)!.isActive).toBe(false))
    await waitFor(() =>
      expect(panel('定期取引の編集').queryByRole('button', { name: '無効にする' })).not.toBeInTheDocument(),
    )
    expect(panel('定期取引の編集').getByRole('button', { name: '有効にする' })).toBeInTheDocument()
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

describe('一覧の表示(計画Issue #164)', () => {
  const rowOf = async (name: string) => (await screen.findByRole('button', { name })).closest('tr')!

  it('繰り返しの欄に、間隔と、土日の調整・終了日・回数の上限の補足が出る', async () => {
    makeRule({ name: '自動車保険', interval: 3, dayOfMonth: 1, startsOn: '2026-01-01', weekendAdjustment: 'previous', endsOn: '2027-03-05', maxOccurrences: 24 })

    renderTab()

    const row = await rowOf('自動車保険')
    expect(within(row).getByText('3か月ごと1日')).toBeInTheDocument()
    expect(within(row).getByText('土日は前の平日')).toBeInTheDocument()
    expect(within(row).getByText('2027/03/05まで')).toBeInTheDocument()
    expect(within(row).getByText('24回まで')).toBeInTheDocument()
  })

  it('次回は土日の調整後の日付で表示される(2026-11-28は土曜日、前平日調整で11/27)', async () => {
    makeRule({ dayOfMonth: 28, weekendAdjustment: 'previous' })

    renderTab()

    expect(within(await rowOf('家賃')).getByText('2026/11/27')).toBeInTheDocument()
  })

  it('金額の初期値が前回確定額のルールは、金額の下に「前回確定額」と出る', async () => {
    makeRule({ name: '電気代', amountMode: 'last_confirmed' })

    renderTab()

    expect(within(await rowOf('電気代')).getByText('前回確定額')).toBeInTheDocument()
  })

  it('終了日を過ぎたルールは、有効のままでも状態が「終了」になり、次回は「-」になる', async () => {
    makeRule({ endsOn: '2026-10-31' })

    renderTab()

    const row = await rowOf('家賃')
    expect(within(row).getByText('終了')).toBeInTheDocument()
    expect(within(row).getByText('-')).toBeInTheDocument()
  })

  it('回数の上限に達したルールも、状態が「終了」になる', async () => {
    const rule = makeRule({ maxOccurrences: 1 })
    insertGeneratedEntry(rule.id, '2026-10-27')

    renderTab()

    expect(within(await rowOf('家賃')).getByText('終了')).toBeInTheDocument()
  })

  it('終了していて無効なルールは、状態が「終了」と表示される(無効より終了を優先する)', async () => {
    rules.deactivate(makeRule({ endsOn: '2026-10-31' }).id)

    renderTab()

    expect(within(await rowOf('家賃')).getByText('終了')).toBeInTheDocument()
  })
})

describe('スケジュールの入力(計画Issue #164)', () => {
  async function openCreateForm() {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    return panel('定期取引の追加')
  }

  it('開始日の既定は今日で、終了日は空、間隔は1、土日の調整は「調整しない」、金額の初期値は固定になる', async () => {
    const form = await openCreateForm()

    expect(form.getByLabelText('開始日')).toHaveValue('2026-11-07')
    expect(form.getByLabelText('終了日(任意)')).toHaveValue('')
    expect(form.getByLabelText('間隔')).toHaveValue('1')
    expect(form.getByLabelText('土日の調整')).toHaveValue('none')
    expect(form.getByRole('radio', { name: '下の金額(固定)' })).toBeChecked()
  })

  it('開始日・終了日・間隔・土日の調整・金額の初期値を入れて登録すると、そのとおりに保存される', async () => {
    const form = await openCreateForm()

    fireEvent.change(form.getByLabelText('名称'), { target: { value: '電気代' } })
    pick(form, '借方の科目', '家賃')
    pick(form, '貸方の科目', '楽天銀行')
    fireEvent.change(form.getByLabelText('金額'), { target: { value: '8000' } })
    fireEvent.change(form.getByLabelText('日'), { target: { value: '10' } })
    fireEvent.change(form.getByLabelText('開始日'), { target: { value: '2026-01-15' } })
    fireEvent.change(form.getByLabelText('終了日(任意)'), { target: { value: '2027-12-31' } })
    fireEvent.change(form.getByLabelText('間隔'), { target: { value: '3' } })
    fireEvent.change(form.getByLabelText('土日の調整'), { target: { value: 'previous' } })
    fireEvent.click(form.getByRole('radio', { name: '前回確定した金額' }))
    fireEvent.click(form.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(rules.findAll()).toHaveLength(1))
    expect(rules.findAll()[0]).toMatchObject({
      startsOn: '2026-01-15',
      endsOn: '2027-12-31',
      interval: 3,
      weekendAdjustment: 'previous',
      amountMode: 'last_confirmed',
    })
  })

  it('間隔の単位は、繰り返しに応じて「週ごと」「か月ごと」「年ごと」に変わる', async () => {
    const form = await openCreateForm()
    expect(form.getByText('か月ごと')).toBeInTheDocument()

    fireEvent.change(form.getByLabelText('繰り返し'), { target: { value: 'weekly' } })
    expect(form.getByText('週ごと')).toBeInTheDocument()

    fireEvent.change(form.getByLabelText('繰り返し'), { target: { value: 'yearly' } })
    expect(form.getByText('年ごと')).toBeInTheDocument()
  })

  it('終了日が開始日より前だと、登録できない', async () => {
    const form = await openCreateForm()
    fireEvent.change(form.getByLabelText('名称'), { target: { value: '家賃' } })
    pick(form, '借方の科目', '家賃')
    pick(form, '貸方の科目', '楽天銀行')
    fireEvent.change(form.getByLabelText('金額'), { target: { value: '98000' } })
    fireEvent.change(form.getByLabelText('日'), { target: { value: '27' } })
    expect(form.getByRole('button', { name: '登録' })).toBeEnabled()

    fireEvent.change(form.getByLabelText('終了日(任意)'), { target: { value: '2026-11-06' } })

    expect(form.getByRole('button', { name: '登録' })).toBeDisabled()
  })

  it('これからの期日が、土日の調整後の日付で数件プレビューされる(毎月28日・前平日調整)', async () => {
    const form = await openCreateForm()
    fireEvent.change(form.getByLabelText('日'), { target: { value: '28' } })
    fireEvent.change(form.getByLabelText('土日の調整'), { target: { value: 'previous' } })

    const preview = form.getByLabelText('期日のプレビュー')

    // 2026-11-28は土曜日→11/27、12/28は月曜日、2027-01-28は木曜日
    expect(preview).toHaveTextContent('2026/11/27')
    expect(preview).toHaveTextContent('2026/12/28')
    expect(preview).toHaveTextContent('2027/01/28')
  })

  it('繰り返しの入力が揃っていないときは、プレビューを出さない', async () => {
    const form = await openCreateForm()

    expect(form.queryByLabelText('期日のプレビュー')).not.toBeInTheDocument()
  })
})

describe('パネルの見た目(計画Issue #164、仕訳エディタと同じ借方・貸方の2列)', () => {
  it('借方・貸方の2列があり、ルールの表で持てない項目(貸方の金額・行の追加・削除など)は無効で表示される', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')

    const debit = within(form.getByRole('group', { name: '借方' }))
    const credit = within(form.getByRole('group', { name: '貸方' }))

    expect(debit.getByLabelText('金額')).toBeEnabled()
    expect(credit.getByLabelText('貸方の金額')).toBeDisabled()
    expect(debit.getByRole('button', { name: '+ 借方の行を追加' })).toBeDisabled()
    expect(credit.getByRole('button', { name: '+ 貸方の行を追加' })).toBeDisabled()
    expect(debit.getByRole('button', { name: '行を削除' })).toBeDisabled()
    expect(credit.getByLabelText('貸方のプロジェクト(借方と同じ)')).toBeDisabled()
    expect(form.getByRole('status')).toHaveTextContent('貸借一致')
  })

  it('貸方の金額は借方の金額と同じ値で表示される', async () => {
    makeRule()
    renderTab()
    await open('家賃')

    const credit = within(panel('定期取引の編集').getByRole('group', { name: '貸方' }))

    expect(credit.getByLabelText('貸方の金額')).toHaveValue('98000')
  })

  it('精算バッチの入力は出ない(計画Issue #180で対応)', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))

    expect(panel('定期取引の追加').queryByLabelText('精算バッチ')).not.toBeInTheDocument()
  })
})

describe('再有効化(計画Issue #164)', () => {
  it('無効なルールには「有効にする」が出て、「無効にする」は出ない', async () => {
    rules.deactivate(makeRule().id)
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')

    expect(editor.getByRole('button', { name: '有効にする' })).toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '無効にする' })).not.toBeInTheDocument()
    expect(editor.getByText('状態: 無効')).toBeInTheDocument()
  })

  it('「有効にする」を押すと再開日の選択が開き、既定は今日。そのまま再開すると今日が再開日になる', async () => {
    const rule = makeRule()
    rules.deactivate(rule.id)
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '有効にする' }))
    const resume = within(screen.getByRole('group', { name: '再開日の選択' }))
    expect(resume.getByLabelText('再開日')).toHaveValue('2026-11-07')
    fireEvent.click(resume.getByRole('button', { name: 'この日から再開' }))

    await waitFor(() => expect(rules.findById(rule.id)).toMatchObject({ isActive: true, resumedOn: '2026-11-07' }))
    await waitFor(() =>
      expect(panel('定期取引の編集').getByRole('button', { name: '無効にする' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('group', { name: '再開日の選択' })).not.toBeInTheDocument()
  })

  it('過去の日付を再開日に選べる', async () => {
    const rule = makeRule()
    rules.deactivate(rule.id)
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '有効にする' }))
    const resume = within(screen.getByRole('group', { name: '再開日の選択' }))
    fireEvent.change(resume.getByLabelText('再開日'), { target: { value: '2026-09-01' } })
    fireEvent.click(resume.getByRole('button', { name: 'この日から再開' }))

    await waitFor(() => expect(rules.findById(rule.id)!.resumedOn).toBe('2026-09-01'))
  })

  it('「やめる」を押すと再開日の選択が閉じ、有効にならない', async () => {
    const rule = makeRule()
    rules.deactivate(rule.id)
    renderTab()
    await open('家賃')

    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '有効にする' }))
    fireEvent.click(within(screen.getByRole('group', { name: '再開日の選択' })).getByRole('button', { name: 'やめる' }))

    expect(screen.queryByRole('group', { name: '再開日の選択' })).not.toBeInTheDocument()
    expect(rules.findById(rule.id)!.isActive).toBe(false)
  })

  it('有効なルールには「有効にする」が出ず、従来どおり「無効にする」が出る', async () => {
    makeRule()
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')

    expect(editor.getByRole('button', { name: '無効にする' })).toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '有効にする' })).not.toBeInTheDocument()
  })

  it('終了したルール(終了日の経過)は、無効でも「有効にする」が出ず、終了の理由と延長の案内が出る', async () => {
    rules.deactivate(makeRule({ endsOn: '2026-10-31' }).id)
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')

    expect(editor.queryByRole('button', { name: '有効にする' })).not.toBeInTheDocument()
    expect(editor.getByText('状態: 終了')).toBeInTheDocument()
    expect(editor.getByText(/終了日\(2026\/10\/31\)を過ぎたため、提案は出ません/)).toBeInTheDocument()
    expect(editor.getByText(/終了日か回数の上限を編集して保存してください/)).toBeInTheDocument()
  })

  it('終了したルール(回数の上限に到達)は、「有効にする」が出ず、回数の上限の理由が出る', async () => {
    const rule = makeRule({ maxOccurrences: 1 })
    insertGeneratedEntry(rule.id, '2026-10-27')
    rules.deactivate(rule.id)
    renderTab()
    await open('家賃')

    const editor = panel('定期取引の編集')

    expect(editor.queryByRole('button', { name: '有効にする' })).not.toBeInTheDocument()
    expect(editor.getByText(/回数の上限\(1回\)に達したため、提案は出ません/)).toBeInTheDocument()
  })

  it('終了日を延ばして保存すると、終了ではなくなり、無効なルールなら「有効にする」が出る', async () => {
    rules.deactivate(makeRule({ endsOn: '2026-10-31' }).id)
    renderTab()
    await open('家賃')

    fireEvent.change(panel('定期取引の編集').getByLabelText('終了日(任意)'), { target: { value: '2027-03-31' } })
    fireEvent.click(panel('定期取引の編集').getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(panel('定期取引の編集').getByRole('button', { name: '有効にする' })).toBeInTheDocument(),
    )
    expect(panel('定期取引の編集').getByText('状態: 無効')).toBeInTheDocument()
  })
})

/** 生成済みの仕訳を1件足す(回数の上限の判定に使う) */
function insertGeneratedEntry(ruleId: number, dueDate: string) {
  new SqlJsJournalEntryRepository(db).create({
    entryDate: dueDate,
    sourceType: 'recurring_generated',
    generatedFromRuleId: ruleId,
    recurringDueDate: dueDate,
    householdMemberId: memberId,
    lines: [
      { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 98000 },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 98000 },
    ],
  })
}

describe('操作に失敗したときのエラー表示(計画Issue #164)', () => {
  /** 作成だけが、指定した理由で失敗するRepository(ほかはSQLiteの実装に委ねる) */
  const failingCreate = (reason: string) => ({
    findAll: () => rules.findAll(),
    create: () => {
      throw new Error(reason)
    },
    update: (...args: Parameters<typeof rules.update>) => rules.update(...args),
    delete: (id: number) => rules.delete(id),
    deactivate: (id: number) => rules.deactivate(id),
    activate: (...args: Parameters<typeof rules.activate>) => rules.activate(...args),
    countGeneratedJournalEntries: (id: number) => rules.countGeneratedJournalEntries(id),
  })

  async function submitCreate() {
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))
    const form = panel('定期取引の追加')
    fireEvent.change(form.getByLabelText('名称'), { target: { value: '家賃' } })
    pick(form, '借方の科目', '家賃')
    pick(form, '貸方の科目', '楽天銀行')
    fireEvent.change(form.getByLabelText('金額', { exact: true }), { target: { value: '98000' } })
    fireEvent.change(form.getByLabelText('日', { exact: true }), { target: { value: '27' } })
    fireEvent.click(form.getByRole('button', { name: '登録' }))
    return form
  }

  it('登録に失敗すると、右パネルの中の「登録」ボタンの直上にエラーを表示する(画面上部ではない)', async () => {
    renderTab(failingCreate('table recurring_transaction_rules has no column named starts_on'))

    const form = await submitCreate()

    const alert = await form.findByRole('alert')
    expect(alert).toHaveTextContent('登録に失敗しました。もう一度お試しください。')
    const register = form.getByRole('button', { name: '登録' })
    expect(alert.compareDocumentPosition(register) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 画面上部(右パネルの外)には、エラーを出さない
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('エラーには、失敗の原因(例外のメッセージ)も添えて表示する', async () => {
    renderTab(failingCreate('table recurring_transaction_rules has no column named starts_on'))

    const form = await submitCreate()

    expect(await form.findByText(/原因: .*no column named starts_on/)).toBeInTheDocument()
  })

  it('操作をやり直して成功すると、エラーは消える', async () => {
    renderTab(failingCreate('boom'))
    const form = await submitCreate()
    await form.findByRole('alert')

    fireEvent.click(form.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(await screen.findByRole('button', { name: '定期取引を追加' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
