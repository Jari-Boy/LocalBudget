// @vitest-environment jsdom
/**
 * 分析画面の「グラフ分析」タブ(ChartsTab、計画Issue #155)のコンポーネントテスト。
 * 承認済みモックアップの構成(要約の一文、主要な数字、月次の収益と費用、純資産の推移、費用の内訳、
 * グループ別の費用の推移、月次の数値の表)に沿って次を検証する。
 * - 主要な数字(収益・費用・収支・貯蓄率・期末の純資産)と、比較があるときの前期比・前年同期比
 * - 期間が12か月未満でも、推移のグラフは直近12か月を出す
 * - グラフにカーソルを合わせると、対象の仕訳行を金額順に上位5行出し、クリックで全行を固定表示する。
 *   固定表示の行の合計は、グラフの金額と一致する
 * - 内訳の行から、仕訳一覧へ(その日・科目・選んだ条件を引き継いで)移動できる
 * - グラフと同じ数値を、月次の表でも確認できる
 * sql.jsのNode実装(createTestDatabase)を使う統合的なレンダリングテスト。外部依存: sql.js のみ。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
let foodId: number

beforeEach(async () => {
  const db = await createTestDatabase()
  runMigrations(db)
  const accountRepository = new SqlJsAccountRepository(db)
  const accountGroupRepository = new SqlJsAccountGroupRepository(db)
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  const householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  repositories = {
    accountRepository,
    accountGroupRepository,
    journalEntryRepository,
    householdMemberRepository,
    projectRepository: new SqlJsProjectRepository(db),
    projectGroupRepository: new SqlJsProjectGroupRepository(db),
    counterpartyRepository: new SqlJsCounterpartyRepository(db),
    counterpartyGroupRepository: new SqlJsCounterpartyGroupRepository(db),
    budgetRepository: new SqlJsBudgetRepository(db),
  }
  const memberId = householdMemberRepository.create({ name: '自分' }).id
  const living = accountGroupRepository.create({ name: '生活', category: 'expense' })
  const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  const equity = accountRepository.create({ category: 'equity', name: '初期残高', isReconcilable: null, isSystemManaged: true }).id
  const salary = accountRepository.create({ category: 'revenue', name: '給与', isReconcilable: null }).id
  foodId = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null, accountGroupId: living.id }).id
  const supplies = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null, accountGroupId: living.id }).id
  const insurance = accountRepository.create({ category: 'expense', name: '社会保険料', isReconcilable: null }).id

  const entry = (entryDate: string, memo: string, lines: [number, 'debit' | 'credit', number][]) =>
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate,
      memo,
      lines: lines.map(([accountId, side, amount]) => ({ accountId, side, amount, householdMemberId: memberId })),
    })
  entry('2026-05-01', '初期残高', [[cash, 'debit', 100000], [equity, 'credit', 100000]])
  entry('2026-06-10', '食費(前月)', [[foodId, 'debit', 4000], [cash, 'credit', 4000]])
  entry('2026-07-05', '給料', [[cash, 'debit', 250000], [salary, 'credit', 250000]])
  entry('2026-07-10', 'スーパー', [[foodId, 'debit', 6000], [cash, 'credit', 6000]])
  entry('2026-07-11', 'コンビニ', [[foodId, 'debit', 700], [cash, 'credit', 700]])
  entry('2026-07-12', '洗剤', [[supplies, 'debit', 800], [cash, 'credit', 800]])
  entry('2026-07-13', '国民年金', [[insurance, 'debit', 1000], [cash, 'credit', 1000]])
  entry('2026-07-14', 'ティッシュ', [[supplies, 'debit', 300], [cash, 'credit', 300]])
  entry('2026-07-15', '文具', [[supplies, 'debit', 200], [cash, 'credit', 200]])
  entry('2026-07-16', 'シャンプー', [[supplies, 'debit', 100], [cash, 'credit', 100]])
})

afterEach(cleanup)

async function openCharts(onOpenJournal: (filter: unknown) => void = () => {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <AnalysisScreen repositories={repositories} today="2026-07-20" onOpenJournal={onOpenJournal} />
    </I18nextProvider>,
  )
  fireEvent.click(await screen.findByRole('tab', { name: 'グラフ分析' }))
}

const kpi = (label: string) => screen.getByText(label, { selector: '.analysis__kpi-label' }).closest('.analysis__kpi') as HTMLElement
const chart = (name: string) => screen.getByRole('region', { name })

describe('ChartsTab(主要な数字と要約)', () => {
  it('主要な数字として、収益・費用・収支・貯蓄率・期末の純資産を出す', async () => {
    await openCharts()
    expect(within(kpi('収益')).getByText('￥250,000')).toBeInTheDocument()
    expect(within(kpi('費用')).getByText('￥9,100')).toBeInTheDocument()
    expect(within(kpi('収支')).getByText('+￥240,900')).toBeInTheDocument()
    expect(within(kpi('貯蓄率')).getByText('96%')).toBeInTheDocument()
    expect(within(kpi('純資産(期末)')).getByText('￥336,900')).toBeInTheDocument()
  })

  it('要約の一文に、期間の収支・最も大きい費用の科目と割合・期末の純資産を出す', async () => {
    await openCharts()
    expect(
      screen.getByText('2026年7月の収支は+￥240,900です。費用で最も大きいのは食費(74%)で、期末の純資産は￥336,900です。'),
    ).toBeInTheDocument()
  })

  it('比較「前期」を選ぶと、主要な数字に前期比を出す', async () => {
    await openCharts()
    fireEvent.change(screen.getByLabelText('比較'), { target: { value: 'previousPeriod' } })
    expect(within(kpi('収益')).getByText('前期比 +￥250,000')).toBeInTheDocument()
  })
})

describe('ChartsTab(グラフ)', () => {
  it('月次の収益と費用・純資産の推移・費用の内訳・費用の推移(グループ別)の4つを出す', async () => {
    await openCharts()
    for (const name of ['月次の収益と費用', '純資産の推移', '費用の内訳', '費用の推移(グループ別)']) {
      expect(chart(name)).toBeInTheDocument()
    }
  })

  it('期間が1か月でも、推移のグラフは直近12か月を出す', async () => {
    await openCharts()
    const hits = within(chart('月次の収益と費用')).getAllByRole('button')
    expect(hits).toHaveLength(12)
  })

  it('グラフにカーソルを合わせると、費用の仕訳行を金額順に上位5行出す', async () => {
    await openCharts()
    const flow = chart('月次の収益と費用')
    fireEvent.mouseEnter(within(flow).getByRole('button', { name: /^7月/ }))
    const tip = within(flow).getByRole('tooltip')
    const memos = within(tip).getAllByTestId('analysis-line-memo').map((n) => n.textContent)
    expect(memos).toContain('給料')
    expect(memos).toContain('スーパー')
    // 費用の行は6行あるので、上位5行(金額順)だけが出て、最も小さい行は出ない
    expect(memos).not.toContain('シャンプー')
    expect(within(tip).getByText(/ほか2行/)).toBeInTheDocument()
  })

  it('クリックすると全行を固定表示し、費用の行の合計がグラフの金額と一致する', async () => {
    await openCharts()
    const flow = chart('月次の収益と費用')
    fireEvent.click(within(flow).getByRole('button', { name: /^7月/ }))
    const detail = within(flow).getByRole('region', { name: '7月の内訳' })
    expect(within(detail).getByText('費用 ￥9,100(7行)')).toBeInTheDocument()
    expect(within(detail).getByText('収益 ￥250,000(1行)')).toBeInTheDocument()
    expect(within(detail).getByText('シャンプー')).toBeInTheDocument()
  })

  it('固定表示した行を押すと、その日・科目・選んだ条件を引き継いで仕訳一覧へ移動する', async () => {
    const onOpenJournal = vi.fn()
    await openCharts(onOpenJournal)
    const flow = chart('月次の収益と費用')
    fireEvent.click(within(flow).getByRole('button', { name: /^7月/ }))
    fireEvent.click(within(within(flow).getByRole('region', { name: '7月の内訳' })).getByRole('button', { name: /スーパー/ }))
    expect(onOpenJournal).toHaveBeenCalledWith({ dateFrom: '2026-07-10', dateTo: '2026-07-10', accountIds: [foodId] })
  })

  it('純資産の推移は、純資産の増減の内訳(収益・費用に加えて初期残高の仕訳)を固定表示できる', async () => {
    await openCharts()
    const equity = chart('純資産の推移')
    fireEvent.click(within(equity).getByRole('button', { name: /^5月/ }))
    const detail = within(equity).getByRole('region', { name: '5月の内訳' })
    expect(within(detail).getByText('初期残高', { selector: '[data-testid="analysis-line-memo"]' })).toBeInTheDocument()
  })

  it('費用の内訳は、金額の大きい順に科目を並べ、割合を出す', async () => {
    await openCharts()
    const breakdown = chart('費用の内訳')
    const names = within(breakdown).getAllByTestId('analysis-breakdown-name').map((n) => n.textContent)
    expect(names).toEqual(['食費', '日用品', '社会保険料'])
    expect(within(breakdown).getByText('74%')).toBeInTheDocument()
  })

  it('費用の内訳の行にカーソルを合わせると、その科目の仕訳行を出し、押すと全行を固定表示する', async () => {
    await openCharts()
    const breakdown = chart('費用の内訳')
    fireEvent.mouseEnter(within(breakdown).getByRole('button', { name: /^食費/ }))
    expect(within(breakdown).getByRole('tooltip')).toHaveTextContent('スーパー')
    fireEvent.click(within(breakdown).getByRole('button', { name: /^食費/ }))
    expect(within(breakdown).getByText('2026年7月 食費(2行)')).toBeInTheDocument()
  })
})

describe('ChartsTab(月次の数値の表)', () => {
  it('グラフと同じ数値を、月次の表(収益・費用・収支・純資産・グループ別)でも確認できる', async () => {
    await openCharts()
    const details = screen.getByText('月次の数値を表で見る').closest('details') as HTMLElement
    const july = within(details).getByText('2026年7月').closest('tr') as HTMLElement
    expect(within(july).getByText('￥250,000')).toBeInTheDocument()
    expect(within(july).getByText('￥9,100')).toBeInTheDocument()
    expect(within(july).getByText('+￥240,900')).toBeInTheDocument()
    expect(within(july).getByText('￥336,900')).toBeInTheDocument()
    expect(within(details).getByRole('columnheader', { name: '生活' })).toBeInTheDocument()
  })
})
