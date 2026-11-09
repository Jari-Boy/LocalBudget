// @vitest-environment jsdom
/**
 * 分析画面(AnalysisScreen、計画Issue #155)のうち、画面の枠・条件バー・「財務諸表」タブの
 * コンポーネントテスト。承認済みモックアップの構成(見出し「分析」・条件バー・3つのタブ・
 * PLとBSを並べた財務諸表)に沿って次を検証する。
 * - 期間のプリセットと開始・終了(月、または日付)、比較(前期・前年同期)を変えると表に反映される
 * - マスタの科目グループで階層表示し、グループを折りたためる(グループの合計は変わらない)
 * - 比較列と差額列、BSの基準日は期間の終了日、貸借の一致表示
 * - 純資産は初期残高(純資産科目)と損益の累計に分けて表示する
 * - 科目名を押すと、期間と選んだ条件を引き継いで仕訳一覧へ移動する
 * sql.jsのNode実装(createTestDatabase)を使う統合的なレンダリングテスト。外部依存: sql.js のみ。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
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

let db: Database
let repositories: AnalysisRepositories
let accountRepository: SqlJsAccountRepository
let accountGroupRepository: SqlJsAccountGroupRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number
let cashId: number
let equityId: number
let salaryId: number
let foodId: number
let eatingOutId: number
let suppliesId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  accountGroupRepository = new SqlJsAccountGroupRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
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
  memberId = householdMemberRepository.create({ name: '自分' }).id

  const groupLiving = accountGroupRepository.create({ name: '生活', category: 'expense' })
  const groupFood = accountGroupRepository.create({ name: '食', category: 'expense', parentGroupId: groupLiving.id })
  cashId = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  equityId = accountRepository.create({ category: 'equity', name: '初期残高', isReconcilable: null, isSystemManaged: true }).id
  salaryId = accountRepository.create({ category: 'revenue', name: '給与', isReconcilable: null }).id
  foodId = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null, accountGroupId: groupFood.id }).id
  eatingOutId = accountRepository.create({ category: 'expense', name: '外食', isReconcilable: null, accountGroupId: groupFood.id }).id
  suppliesId = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null, accountGroupId: groupLiving.id }).id

  const entry = (entryDate: string, memo: string, lines: [number, 'debit' | 'credit', number][]) =>
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate,
      memo,
      lines: lines.map(([accountId, side, amount]) => ({ accountId, side, amount })),
    })
  entry('2026-05-01', '初期残高', [[cashId, 'debit', 100000], [equityId, 'credit', 100000]])
  entry('2026-06-10', '食費(前月)', [[foodId, 'debit', 4000], [cashId, 'credit', 4000]])
  entry('2026-07-05', '給料', [[cashId, 'debit', 250000], [salaryId, 'credit', 250000]])
  entry('2026-07-10', 'スーパー', [[foodId, 'debit', 6000], [cashId, 'credit', 6000]])
  entry('2026-07-12', 'ランチ', [[eatingOutId, 'debit', 1500], [cashId, 'credit', 1500]])
  entry('2026-07-14', '洗剤', [[suppliesId, 'debit', 800], [cashId, 'credit', 800]])
})

afterEach(cleanup)

function renderScreen(onOpenJournal: (filter: unknown) => void = () => {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AnalysisScreen repositories={repositories} today="2026-07-15" onOpenJournal={onOpenJournal} />
    </I18nextProvider>,
  )
}

const plSection = () => screen.getByRole('region', { name: '損益計算書(PL)' })
const bsSection = () => screen.getByRole('region', { name: '貸借対照表(BS)' })
const rowOf = (section: HTMLElement, name: string) => within(section).getByText(name).closest('tr')!

describe('AnalysisScreen(画面の枠と条件バー)', () => {
  it('見出し「分析」、条件バー、3つのタブ(財務諸表・グラフ分析・予算)を表示し、最初は財務諸表タブを開く', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { name: '分析' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '分析の条件' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: '分析の種類' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['財務諸表', 'グラフ分析', '予算'])
    expect(screen.getByRole('tab', { name: '財務諸表' })).toHaveAttribute('aria-selected', 'true')
  })

  it('期間のプリセットは「今月」から始まり、今日が属する月の月初〜月末が選ばれている', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '分析' })
    expect(screen.getByRole('button', { name: '今月' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('開始')).toHaveValue('2026-07')
    expect(screen.getByLabelText('終了(BSの基準月)')).toHaveValue('2026-07')
  })

  it('プリセット「直近3か月」を押すと、期間が3か月分になり、表の数字に反映される', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '分析' })
    expect(within(rowOf(plSection(), '食費')).getByText('￥6,000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '直近3か月' }))
    expect(screen.getByLabelText('開始')).toHaveValue('2026-05')
    expect(within(rowOf(plSection(), '食費')).getByText('￥10,000')).toBeInTheDocument()
  })

  it('開始・終了の月を変えると、プリセットの選択が外れて期間が変わる', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '分析' })
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-06' } })
    expect(screen.getByRole('button', { name: '今月' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(rowOf(plSection(), '食費')).getByText('￥10,000')).toBeInTheDocument()
  })

  it('「日付で指定」にすると日付の入力に変わり、日単位の期間で集計できる', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '分析' })
    fireEvent.click(screen.getByLabelText('日付で指定'))
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-07-11' } })
    fireEvent.change(screen.getByLabelText('終了(BSの基準日)'), { target: { value: '2026-07-13' } })
    expect(within(plSection()).queryByText('食費')).toBeNull()
    expect(within(rowOf(plSection(), '外食')).getByText('￥1,500')).toBeInTheDocument()
  })
})

describe('AnalysisScreen(財務諸表タブ)', () => {
  it('PLに収益・費用を科目グループの階層で表示し、合計と当期純利益を出す', async () => {
    renderScreen()
    const pl = await screen.findByRole('region', { name: '損益計算書(PL)' })
    expect(within(rowOf(pl, '生活')).getByText('￥8,300')).toBeInTheDocument()
    expect(within(rowOf(pl, '食')).getByText('￥7,500')).toBeInTheDocument()
    expect(within(rowOf(pl, '収益合計')).getByText('￥250,000')).toBeInTheDocument()
    expect(within(rowOf(pl, '費用合計')).getByText('￥8,300')).toBeInTheDocument()
    expect(within(rowOf(pl, '当期純利益')).getByText('+￥241,700')).toBeInTheDocument()
  })

  it('グループの開閉ボタンで配下の科目を隠せて、グループの合計は変わらない', async () => {
    renderScreen()
    const pl = await screen.findByRole('region', { name: '損益計算書(PL)' })
    expect(within(pl).getByText('外食')).toBeInTheDocument()
    fireEvent.click(within(pl).getByRole('button', { name: '食を開閉' }))
    expect(within(pl).queryByText('外食')).toBeNull()
    expect(within(rowOf(pl, '食')).getByText('￥7,500')).toBeInTheDocument()
  })

  it('BSの基準日は期間の終了日で、資産・負債・純資産と、貸借の一致を表示する', async () => {
    renderScreen()
    const bs = await screen.findByRole('region', { name: '貸借対照表(BS)' })
    expect(within(bs).getByText('2026-07-31時点')).toBeInTheDocument()
    expect(within(rowOf(bs, '現金')).getByText('￥337,700')).toBeInTheDocument()
    expect(within(rowOf(bs, '資産合計')).getByText('￥337,700')).toBeInTheDocument()
    expect(within(bs).getByText(/貸借が一致しています/)).toBeInTheDocument()
  })

  it('BSの純資産は、初期残高と損益の累計に分けて表示する', async () => {
    renderScreen()
    const bs = await screen.findByRole('region', { name: '貸借対照表(BS)' })
    expect(within(rowOf(bs, '初期残高')).getByText('￥100,000')).toBeInTheDocument()
    expect(within(rowOf(bs, '損益の累計')).getByText('￥237,700')).toBeInTheDocument()
    expect(within(rowOf(bs, '純資産合計')).getByText('￥337,700')).toBeInTheDocument()
  })

  it('期間の終了日を変えると、BSの基準日も変わる', async () => {
    renderScreen()
    await screen.findByRole('region', { name: '貸借対照表(BS)' })
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-06' } })
    fireEvent.change(screen.getByLabelText('終了(BSの基準月)'), { target: { value: '2026-06' } })
    const bs = bsSection()
    expect(within(bs).getByText('2026-06-30時点')).toBeInTheDocument()
    expect(within(rowOf(bs, '現金')).getByText('￥96,000')).toBeInTheDocument()
  })

  it('比較「前期」を選ぶと、比較列と差額列を出す', async () => {
    renderScreen()
    await screen.findByRole('region', { name: '損益計算書(PL)' })
    fireEvent.change(screen.getByLabelText('比較'), { target: { value: 'previousPeriod' } })
    const pl = plSection()
    expect(within(pl).getByRole('columnheader', { name: '差額' })).toBeInTheDocument()
    const food = rowOf(pl, '食費')
    // 前期は同じ日数の直前の期間(5/31〜6/30)で、食費は6/10の4,000円
    expect(within(food).getByText('￥6,000')).toBeInTheDocument()
    expect(within(food).getByText('￥4,000')).toBeInTheDocument()
    expect(within(food).getByText('+￥2,000')).toBeInTheDocument()
  })

  it('比較なしのときは、差額列を出さない', async () => {
    renderScreen()
    await screen.findByRole('region', { name: '損益計算書(PL)' })
    expect(within(plSection()).queryByRole('columnheader', { name: '差額' })).toBeNull()
  })

  it('科目名を押すと、期間と科目を引き継いで仕訳一覧へ移動する', async () => {
    const onOpenJournal = vi.fn()
    renderScreen(onOpenJournal)
    const pl = await screen.findByRole('region', { name: '損益計算書(PL)' })
    fireEvent.click(within(pl).getByRole('button', { name: '食費' }))
    expect(onOpenJournal).toHaveBeenCalledWith({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      accountIds: [foodId],
    })
  })
})
