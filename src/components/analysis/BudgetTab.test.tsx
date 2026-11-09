// @vitest-environment jsdom
/**
 * 分析画面の「予算」タブ(BudgetTab、計画Issue #155、旧計画Issue #35)のコンポーネントテスト。
 * 承認済みモックアップの構成に沿って次を検証する。
 * - 期間の終了月の予算を、主要な数字(予算・予算のある科目の実績・残り・予算のない費用)で出す
 * - 費用の科目をマスタのグループで階層表示し、予算の入力・実績・残り・消化率を並べる。
 *   超過は色だけでなく文字(「✕ 超過」)でも示し、未設定は「未設定」と表示する
 * - 予算の入力で作成・変更し、空にすると削除する(sql.jsのBudgetRepositoryに保存される)
 * - 「先月の内容をコピー」は、対象月にすでにある予算を上書きせず、まだ無い科目だけを作る
 * - 世帯メンバーなどの絞り込みは、予算タブには適用しない
 * - 科目名を押すと、その月の仕訳一覧へ移動する
 * sql.jsのNode実装(createTestDatabase)を使う統合的なレンダリングテスト。外部依存: sql.js のみ。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../../infrastructure/db/SqlJsBudgetRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { AnalysisScreen } from './AnalysisScreen'
import type { AnalysisRepositories } from './analysisData'

let repositories: AnalysisRepositories
let budgetRepository: SqlJsBudgetRepository
let foodId: number
let suppliesId: number
let transportId: number

beforeEach(async () => {
  const db = await createTestDatabase()
  runMigrations(db)
  const accountRepository = new SqlJsAccountRepository(db)
  const accountGroupRepository = new SqlJsAccountGroupRepository(db)
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  const householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  budgetRepository = new SqlJsBudgetRepository(db)
  repositories = {
    accountRepository,
    accountGroupRepository,
    journalEntryRepository,
    householdMemberRepository,
    projectRepository: new SqlJsProjectRepository(db),
    projectGroupRepository: new SqlJsProjectGroupRepository(db),
    counterpartyRepository: new SqlJsCounterpartyRepository(db),
    counterpartyGroupRepository: new SqlJsCounterpartyGroupRepository(db),
    budgetRepository,
  }
  const memberId = householdMemberRepository.create({ name: '自分' }).id
  const otherMemberId = householdMemberRepository.create({ name: '家族' }).id
  const living = accountGroupRepository.create({ name: '生活', category: 'expense' })
  const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodId = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null, accountGroupId: living.id }).id
  suppliesId = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null, accountGroupId: living.id }).id
  transportId = accountRepository.create({ category: 'expense', name: '交通費', isReconcilable: null }).id

  const entry = (entryDate: string, memo: string, accountId: number, amount: number, member = memberId) =>
    journalEntryRepository.create({
      householdMemberId: member,
      entryDate,
      memo,
      lines: [
        { accountId, side: 'debit', amount },
        { accountId: cash, side: 'credit', amount },
      ],
    })
  entry('2026-06-10', '食費(6月)', foodId, 20000)
  entry('2026-07-05', 'スーパー', foodId, 30000)
  entry('2026-07-06', 'コンビニ', foodId, 1)
  entry('2026-07-10', '洗剤', suppliesId, 2000, otherMemberId)
  entry('2026-07-12', '電車', transportId, 5000)

  budgetRepository.create({ accountId: foodId, yearMonth: '2026-07', amount: 25000 })
  budgetRepository.create({ accountId: suppliesId, yearMonth: '2026-07', amount: 5000 })
  budgetRepository.create({ accountId: foodId, yearMonth: '2026-06', amount: 28000 })
  budgetRepository.create({ accountId: transportId, yearMonth: '2026-06', amount: 7000 })
})

afterEach(cleanup)

async function openBudget(onOpenJournal: (filter: unknown) => void = () => {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <AnalysisScreen repositories={repositories} today="2026-07-20" onOpenJournal={onOpenJournal} />
    </I18nextProvider>,
  )
  fireEvent.click(await screen.findByRole('tab', { name: '予算' }))
  await screen.findByRole('region', { name: '科目別の予算' })
}

const kpi = (label: string) => screen.getByText(label, { selector: '.analysis__kpi-label' }).closest('.analysis__kpi') as HTMLElement
const table = () => screen.getByRole('region', { name: '科目別の予算' })
const rowOf = (name: string) => within(table()).getByRole('button', { name }).closest('tr') as HTMLElement

describe('BudgetTab(主要な数字と一覧)', () => {
  it('期間の終了月の予算と実績を、主要な数字(予算・実績・残り・予算のない費用)で出す', async () => {
    await openBudget()
    // 食費(予算25,000・実績30,001)と日用品(予算5,000・実績2,000)に予算があり、交通費(5,000)は予算なし
    expect(within(kpi('予算')).getByText('￥30,000')).toBeInTheDocument()
    expect(within(kpi('実績(予算のある科目)')).getByText('￥32,001')).toBeInTheDocument()
    expect(within(kpi('残り')).getByText('-￥2,001')).toBeInTheDocument()
    expect(within(kpi('残り')).getByText('✕ 予算を超過しています')).toBeInTheDocument()
    expect(within(kpi('予算のない費用')).getByText('￥5,000')).toBeInTheDocument()
  })

  it('費用の科目をグループで階層表示し、グループの行は配下の合計を出す', async () => {
    await openBudget()
    const group = within(table()).getByText('生活').closest('tr') as HTMLElement
    expect(within(group).getByText('￥30,000')).toBeInTheDocument()
    expect(within(group).getByText('￥32,001')).toBeInTheDocument()
  })

  it('予算を超えた科目は「✕ 超過」と文字でも示し、予算内の科目は消化率を出す', async () => {
    await openBudget()
    expect(within(rowOf('食費')).getByText('✕ 超過')).toBeInTheDocument()
    expect(within(rowOf('食費')).getByText('-￥5,001')).toBeInTheDocument()
    expect(within(rowOf('日用品')).getByText('40%')).toBeInTheDocument()
    expect(within(rowOf('日用品')).getByText('+￥3,000')).toBeInTheDocument()
  })

  it('予算が未設定の科目は「未設定」と表示する', async () => {
    await openBudget()
    expect(within(rowOf('交通費')).getByText('未設定')).toBeInTheDocument()
    expect(within(rowOf('交通費')).getByLabelText('交通費の予算')).toHaveValue('')
  })

  it('世帯メンバーの絞り込みは、予算タブには適用しない', async () => {
    await openBudget()
    // 条件バーで世帯メンバーを選んでも、予算タブの実績は世帯全体のまま。注記でも伝える
    expect(screen.getByText(/世帯メンバーなどの絞り込みは、このタブには適用しません/)).toBeInTheDocument()
  })

  it('科目名を押すと、その月の仕訳一覧へ科目を引き継いで移動する', async () => {
    const onOpenJournal = vi.fn()
    await openBudget(onOpenJournal)
    fireEvent.click(within(table()).getByRole('button', { name: '食費' }))
    expect(onOpenJournal).toHaveBeenCalledWith({ dateFrom: '2026-07-01', dateTo: '2026-07-31', accountIds: [foodId] })
  })
})

describe('BudgetTab(予算の入力)', () => {
  it('金額を入力すると、予算を作成して保存し、残り・消化率に反映する', async () => {
    await openBudget()
    const input = within(rowOf('交通費')).getByLabelText('交通費の予算')
    fireEvent.change(input, { target: { value: '6000' } })
    fireEvent.blur(input)
    await waitFor(() => expect(budgetRepository.findByAccountAndYearMonth(transportId, '2026-07')?.amount).toBe(6000))
    expect(await within(rowOf('交通費')).findByText('83%')).toBeInTheDocument()
  })

  it('予算のある科目の金額を変えると、その予算を更新する', async () => {
    await openBudget()
    const input = within(rowOf('食費')).getByLabelText('食費の予算')
    fireEvent.change(input, { target: { value: '40000' } })
    fireEvent.blur(input)
    await waitFor(() => expect(budgetRepository.findByAccountAndYearMonth(foodId, '2026-07')?.amount).toBe(40000))
    expect(await within(rowOf('食費')).findByText('+￥9,999')).toBeInTheDocument()
  })

  it('入力を空にすると、その月のその科目の予算を削除する', async () => {
    await openBudget()
    const input = within(rowOf('日用品')).getByLabelText('日用品の予算')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    await waitFor(() => expect(budgetRepository.findByAccountAndYearMonth(suppliesId, '2026-07')).toBeNull())
    expect(await within(rowOf('日用品')).findByText('未設定')).toBeInTheDocument()
  })

  it('数字として読めない入力は保存せず、元の金額に戻す', async () => {
    await openBudget()
    const input = within(rowOf('食費')).getByLabelText('食費の予算')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(budgetRepository.findByAccountAndYearMonth(foodId, '2026-07')?.amount).toBe(25000)
    await waitFor(() => expect(input).toHaveValue('25000'))
  })
})

describe('BudgetTab(先月の内容をコピー)', () => {
  it('先月の予算のうち、対象月にまだ無い科目だけをコピーし、すでにある予算は上書きしない', async () => {
    await openBudget()
    fireEvent.click(screen.getByRole('button', { name: '先月の内容をコピー' }))
    await waitFor(() => expect(budgetRepository.findByAccountAndYearMonth(transportId, '2026-07')?.amount).toBe(7000))
    expect(budgetRepository.findByAccountAndYearMonth(foodId, '2026-07')?.amount).toBe(25000)
    expect(screen.getByText('1件をコピーしました(設定済みの1件はそのままです)')).toBeInTheDocument()
  })

  it('先月の予算がないときは、その旨を表示して何も作らない', async () => {
    for (const b of budgetRepository.findByYearMonth('2026-06')) budgetRepository.delete(b.id)
    await openBudget()
    fireEvent.click(screen.getByRole('button', { name: '先月の内容をコピー' }))
    expect(await screen.findByText('先月の予算がありません')).toBeInTheDocument()
    expect(budgetRepository.findByAccountAndYearMonth(transportId, '2026-07')).toBeNull()
  })
})

describe('BudgetTab(予算と実績の推移)', () => {
  it('予算と実績の推移のグラフを出し、月にカーソルを合わせると予算のある科目の仕訳行を出す', async () => {
    await openBudget()
    const chart = screen.getByRole('region', { name: '予算と実績の推移' })
    fireEvent.mouseEnter(within(chart).getByRole('button', { name: /^7月/ }))
    expect(within(chart).getByRole('tooltip')).toHaveTextContent('スーパー')
    expect(within(chart).getByRole('tooltip')).not.toHaveTextContent('電車')
  })
})
