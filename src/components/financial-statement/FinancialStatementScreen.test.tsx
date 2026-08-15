// @vitest-environment jsdom
/**
 * 財務諸表(PL/BS)表示画面(計画Issue #34)のコンポーネントテスト。
 * docs/domain/financial-statements.md 2.2節が定めるPL(期間指定+月次プリセット)・
 * BS(基準日指定)の単一画面タブ切替表示、プロジェクト・世帯メンバー・取引先の複数選択
 * 絞り込み(タブ切替をまたいだ状態保持を含む)、前期比較(当期/比較期間/差分の表示)、
 * BSの複式簿記恒等式(資産=負債+純資産)が画面表示上も成立することを検証する。
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテスト。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { FinancialStatementScreen } from './FinancialStatementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  memberId = householdMemberRepository.create({ name: '自分' }).id
})

afterEach(cleanup)

function renderScreen(today = '2026-07-15') {
  return render(
    <I18nextProvider i18n={i18n}>
      <FinancialStatementScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={() => {}}
        today={today}
      />
    </I18nextProvider>,
  )
}

function selectMultiOptions(select: HTMLElement, values: string[]) {
  const selectEl = select as HTMLSelectElement
  Array.from(selectEl.options).forEach((option) => {
    option.selected = values.includes(option.value)
  })
  fireEvent.change(selectEl)
}

describe('FinancialStatementScreen', () => {
  it('既定でPLタブが表示され、当月(todayが属する月)の収益・費用が科目別に表示される', async () => {
    const salary = accountRepository.create({ category: 'revenue', name: '給与', isReconcilable: null })
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: cash.id, side: 'debit', amount: 250000 },
        { accountId: salary.id, side: 'credit', amount: 250000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })

    renderScreen()

    const salaryRow = (await screen.findByText('給与')).closest('tr')!
    expect(within(salaryRow).getByText('￥250,000')).toBeInTheDocument()
    const foodRow = screen.getByText('食費').closest('tr')!
    expect(within(foodRow).getByText('￥3,000')).toBeInTheDocument()
  })

  it('BSタブに切り替えると基準日時点の資産・負債・純資産が表示され、恒等式(資産=負債+純資産)が成立する', async () => {
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const equity = accountRepository.create({
      category: 'equity',
      name: '元入金',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      memo: null,
      sourceType: 'initial_balance',
      lines: [
        { accountId: cash.id, side: 'debit', amount: 100000 },
        { accountId: equity.id, side: 'credit', amount: 100000 },
      ],
    })

    renderScreen()
    await screen.findByRole('button', { name: '貸借対照表(BS)' })
    fireEvent.click(screen.getByRole('button', { name: '貸借対照表(BS)' }))

    expect(await screen.findByText('現金')).toBeInTheDocument()
    const assetsAmount = screen.getByText('資産合計:').closest('p')!
    const identityAmount = screen.getByText('資産 = 負債 + 純資産:').closest('p')!
    expect(within(assetsAmount).getByText('￥100,000')).toBeInTheDocument()
    expect(within(identityAmount).getByText('￥100,000')).toBeInTheDocument()
  })

  it('BSで「比較する」を有効にし年月で比較基準を選ぶと、選んだ年月の月末時点の残高と比較される', async () => {
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const equity = accountRepository.create({
      category: 'equity',
      name: '元入金',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-06-01',
      memo: null,
      sourceType: 'initial_balance',
      lines: [
        { accountId: cash.id, side: 'debit', amount: 60000 },
        { accountId: equity.id, side: 'credit', amount: 60000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-05',
      memo: null,
      lines: [
        { accountId: cash.id, side: 'debit', amount: 40000 },
        { accountId: equity.id, side: 'credit', amount: 40000 },
      ],
    })

    renderScreen()
    await screen.findByRole('button', { name: '貸借対照表(BS)' })
    fireEvent.click(screen.getByRole('button', { name: '貸借対照表(BS)' }))
    await screen.findByText('現金')

    fireEvent.click(screen.getByLabelText('比較する'))
    fireEvent.change(screen.getByLabelText('比較基準年月(月末時点)'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('比較基準年月(月末時点)月'), { target: { value: '6' } })

    const totalAssetsRow = screen.getByText('資産合計:').closest('p')!
    // 当期(7月末)は10万円、比較基準(6月末、月末時点に丸められる)は6万円
    expect(within(totalAssetsRow).getByText('￥100,000')).toBeInTheDocument()
    expect(within(totalAssetsRow).getByText('￥60,000')).toBeInTheDocument()
    expect(within(totalAssetsRow).getByText('￥40,000')).toBeInTheDocument()
  })

  it('BSで日付指定モードのとき、比較基準日の入力は当期の基準日より前の日付に制約される', async () => {
    renderScreen()
    await screen.findByRole('button', { name: '貸借対照表(BS)' })
    fireEvent.click(screen.getByRole('button', { name: '貸借対照表(BS)' }))

    fireEvent.click(screen.getByLabelText('日付で指定'))
    fireEvent.change(screen.getByLabelText('基準日'), { target: { value: '2026-07-20' } })
    fireEvent.click(screen.getByLabelText('比較する'))

    const comparisonDateInput = screen.getByLabelText('比較基準日') as HTMLInputElement
    expect(comparisonDateInput.max).toBe('2026-07-19')
  })

  it('プロジェクトを複数選択すると、選択したプロジェクトに紐づく明細のみで集計される', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const tripProject = projectRepository.create({ name: 'アメリカ旅行' })
    const otherProject = projectRepository.create({ name: '別プロジェクト' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 5000, projectId: tripProject.id },
        { accountId: cash.id, side: 'credit', amount: 5000, projectId: tripProject.id },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-11',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 9000, projectId: otherProject.id },
        { accountId: cash.id, side: 'credit', amount: 9000, projectId: otherProject.id },
      ],
    })

    renderScreen()
    await screen.findByText('アメリカ旅行')

    selectMultiOptions(screen.getByLabelText('プロジェクトで絞り込み(複数選択可)'), [String(tripProject.id)])

    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥5,000')).toBeInTheDocument()
    expect(screen.queryByText('￥9,000')).not.toBeInTheDocument()

    // 2件目のプロジェクトも同時選択(複数選択)すると、両方の明細が合算されて表示される
    selectMultiOptions(screen.getByLabelText('プロジェクトで絞り込み(複数選択可)'), [
      String(tripProject.id),
      String(otherProject.id),
    ])
    expect(within(foodRow).getByText('￥14,000')).toBeInTheDocument()
  })

  it('世帯メンバーを複数選択すると、選択したメンバーに紐づく明細のみで集計される', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const otherMemberId = householdMemberRepository.create({ name: '配偶者' }).id
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 4000 },
        { accountId: cash.id, side: 'credit', amount: 4000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: otherMemberId,
      entryDate: '2026-07-11',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 6000 },
        { accountId: cash.id, side: 'credit', amount: 6000 },
      ],
    })

    renderScreen()
    await screen.findByText('配偶者')

    selectMultiOptions(screen.getByLabelText('世帯メンバーで絞り込み(複数選択可)'), [String(otherMemberId)])

    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥6,000')).toBeInTheDocument()
    expect(screen.queryByText('￥4,000')).not.toBeInTheDocument()
  })

  it('取引先を複数選択すると、選択した取引先に紐づく明細のみで集計される', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const supermarket = counterpartyRepository.create({ name: 'スーパーA' })
    const restaurant = counterpartyRepository.create({ name: 'レストランB' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 2000, counterpartyId: supermarket.id },
        { accountId: cash.id, side: 'credit', amount: 2000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-11',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 8000, counterpartyId: restaurant.id },
        { accountId: cash.id, side: 'credit', amount: 8000 },
      ],
    })

    renderScreen()
    await screen.findByText('食費')

    selectMultiOptions(screen.getByLabelText('取引先で絞り込み(複数選択可)'), [String(restaurant.id)])

    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥8,000')).toBeInTheDocument()
    expect(screen.queryByText('￥2,000')).not.toBeInTheDocument()
  })

  it('日付での詳細指定に切り替えて期間を指定すると、その期間の明細でPLが集計される(月の途中で区切れる)', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-05',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-20',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 9000 },
        { accountId: cash.id, side: 'credit', amount: 9000 },
      ],
    })

    renderScreen()
    await screen.findByText('食費')

    fireEvent.click(screen.getByLabelText('日付で指定'))
    fireEvent.change(screen.getByLabelText('期初'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('期末'), { target: { value: '2026-07-10' } })

    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥1,000')).toBeInTheDocument()
    expect(screen.queryByText('￥9,000')).not.toBeInTheDocument()
  })

  it('「今年」プリセットを押すと、当月以外の月の明細も含めて年間で集計される', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-01-15',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 1500 },
        { accountId: cash.id, side: 'credit', amount: 1500 },
      ],
    })

    renderScreen()
    await screen.findAllByText('残高のある科目がありません')

    fireEvent.click(screen.getByRole('button', { name: '今年' }))

    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥1,500')).toBeInTheDocument()
  })

  it('「今年」プリセットで期間を広げた後に「今月」プリセットを押すと、当月分のみの集計に戻る', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-01-15',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 1500 },
        { accountId: cash.id, side: 'credit', amount: 1500 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 2000 },
        { accountId: cash.id, side: 'credit', amount: 2000 },
      ],
    })

    renderScreen()
    await screen.findByText('食費')

    // まず「今年」で1月分・7月分を合算した状態(￥3,500)を作る
    fireEvent.click(screen.getByRole('button', { name: '今年' }))
    const foodRow = (await screen.findByText('食費')).closest('tr')!
    expect(within(foodRow).getByText('￥3,500')).toBeInTheDocument()

    // 「今月」を押すと、当月(7月)分のみの集計(￥2,000)に戻る
    fireEvent.click(screen.getByRole('button', { name: '今月' }))
    expect(within(foodRow).getByText('￥2,000')).toBeInTheDocument()
    expect(within(foodRow).queryByText('￥3,500')).not.toBeInTheDocument()
  })

  it('プロジェクトの選択状態はPL/BSタブを切り替えても保持される', async () => {
    const project = projectRepository.create({ name: 'アメリカ旅行' })
    renderScreen()
    await screen.findByText('アメリカ旅行')

    const projectSelect = screen.getByLabelText('プロジェクトで絞り込み(複数選択可)') as HTMLSelectElement
    selectMultiOptions(projectSelect, [String(project.id)])
    expect(Array.from(projectSelect.selectedOptions).map((o) => o.value)).toEqual([String(project.id)])

    fireEvent.click(screen.getByRole('button', { name: '貸借対照表(BS)' }))
    fireEvent.click(screen.getByRole('button', { name: '損益計算書(PL)' }))

    const projectSelectAfter = screen.getByLabelText('プロジェクトで絞り込み(複数選択可)') as HTMLSelectElement
    expect(Array.from(projectSelectAfter.selectedOptions).map((o) => o.value)).toEqual([String(project.id)])
  })

  it('比較(前期)を選択すると、当期・比較期間・差分の値が表示される', async () => {
    const food = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 3000 },
        { accountId: cash.id, side: 'credit', amount: 3000 },
      ],
    })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-06-10',
      memo: null,
      lines: [
        { accountId: food.id, side: 'debit', amount: 2000 },
        { accountId: cash.id, side: 'credit', amount: 2000 },
      ],
    })

    renderScreen()
    await screen.findByText('食費')

    fireEvent.change(screen.getByLabelText('比較'), { target: { value: 'previousPeriod' } })

    const totalExpenseRow = (await screen.findByText('費用合計:')).closest('p')!
    expect(within(totalExpenseRow).getByText('￥3,000')).toBeInTheDocument()
    expect(within(totalExpenseRow).getByText('￥2,000')).toBeInTheDocument()
    expect(within(totalExpenseRow).getByText('￥1,000')).toBeInTheDocument()
  })

  it('絞り込み結果に該当する残高が1件もない場合は空状態メッセージが表示される', async () => {
    accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    renderScreen()

    expect(await screen.findAllByText('残高のある科目がありません')).not.toHaveLength(0)
  })
})
