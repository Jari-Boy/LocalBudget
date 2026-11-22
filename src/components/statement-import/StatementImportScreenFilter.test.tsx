// @vitest-environment jsdom
/**
 * StatementImportScreen の列ごとの行の絞り込み(計画Issue #258)のコンポーネントテスト。
 * 表見出しの下の絞り込み行(摘要のテキスト・相手科目/取引先/プロジェクト/メンバーの共通の選択欄と「未設定」)で行を絞れること、
 * 複数の条件がANDで効くこと、条件の解除で全行に戻ること、タブの件数が「表示中 / 全体」になること、
 * 絞り込みで隠れた行のチェックが外れること、一括設定と確定が表示中の行だけに及ぶことを確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { seedBalanceAdjustmentAccount } from '../../infrastructure/db/seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsExternalTransactionRefRepository } from '../../infrastructure/db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { SqlJsStatementImportDraftRepository } from '../../infrastructure/db/SqlJsStatementImportDraftRepository'
import { UnsavedGuardHarness } from '../master/UnsavedGuardHarness'
import { chooseMember } from '../master/memberSelectTestHelpers'
import { StatementImportScreen } from './StatementImportScreen'

let db: Database
let accounts: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository
let projects: SqlJsProjectRepository
let mappings: SqlJsImportMappingDefinitionRepository
let bank: ReturnType<SqlJsAccountRepository['create']>

beforeEach(async () => {
  localStorage.clear()
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  projects = new SqlJsProjectRepository(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '自分' })
  new SqlJsHouseholdMemberRepository(db).create({ name: '配偶者' })
  bank = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
  accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
  projects.create({ name: '出張' })
  mappings.create({
    formatGroupId: 'my-bank',
    label: 'マイ銀行',
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    balanceColumn: '残高',
    accountIds: [bank.id],
  })
})

afterEach(cleanup)

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <StatementImportScreen
          accountRepository={accounts}
          accountGroupRepository={new SqlJsAccountGroupRepository(db)}
          importMappingDefinitionRepository={mappings}
          externalTransactionRefRepository={new SqlJsExternalTransactionRefRepository(db)}
          journalEntryRepository={entries}
          counterpartyRepository={new SqlJsCounterpartyRepository(db)}
          keywordRuleRepository={new SqlJsKeywordRuleRepository(db)}
          counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
          projectRepository={projects}
          projectGroupRepository={new SqlJsProjectGroupRepository(db)}
          householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
          settlementBatchRepository={new SqlJsSettlementBatchRepository(db)}
          statementImportDraftRepository={new SqlJsStatementImportDraftRepository(db)}
          onEditMappings={vi.fn()}
        />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

const HEADER = '日付,摘要,金額,残高\n'
/** セブンが2件(表記ゆれ)、ローソン、家賃の4件 */
const CSV = `${HEADER}2026/10/05,セブン-イレブン 新宿店,-648,99352
2026/10/06,セブンイレブン 池袋店,-520,98832
2026/10/07,ローソン 渋谷店,-432,98400
2026/10/08,家賃,-50000,48400
`

async function chooseCsv(content: string) {
  fireEvent.change(await screen.findByLabelText('CSVを選択'), {
    target: { files: [new File([content], 'statement.csv', { type: 'text/csv' })] },
  })
  await screen.findByText(/statement\.csv を読み込み済み/)
  if (screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })) chooseMember('誰の明細か(必須)', '自分')
}

/** 補助行にも同じ摘要が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const hasRow = (text: string | RegExp) => screen.queryAllByRole('row', { name: text }).length > 0
const pickIn = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}
/** 絞り込み行の選択欄(表の見出しの中)から選ぶ */
const pickFilter = (label: string, item: string) => pickIn(within(screen.getByRole('table')), label, item)
/** 行の世帯メンバーの選択欄から選ぶ */
const pickMemberInRow = (rowText: RegExp, name: string) => {
  fireEvent.click(rowOf(rowText).getByRole('button', { name: /の世帯メンバー/ }))
  fireEvent.click(within(screen.getByRole('dialog', { name: /の世帯メンバー/ })).getByRole('button', { name }))
}
const typeDescriptionFilter = (text: string) =>
  fireEvent.change(screen.getByLabelText('摘要で絞り込み'), { target: { value: text } })
const confirmButton = (count: number) => screen.getByRole('button', { name: new RegExp(`^\\d+ / ${count} 件を「普通預金」に確定$`) })

describe('StatementImportScreen: 列ごとの行の絞り込み(計画Issue #258)', () => {
  it('摘要で絞り込むと、表記ゆれ(ハイフンの有無)を含めて該当する行だけが表示され、条件を解除すると全行に戻る', async () => {
    renderScreen()
    await chooseCsv(CSV)

    typeDescriptionFilter('セブンイレブン')
    expect(hasRow(/新宿店/)).toBe(false)
    expect(hasRow(/池袋店/)).toBe(true)
    typeDescriptionFilter('セブン')
    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(false)
    expect(hasRow(/家賃/)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))

    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(screen.getByLabelText('摘要で絞り込み')).toHaveValue('')
  })

  it('絞り込み中は「N件のうちM件を表示」の案内と、タブの「表示中 / 全体」の件数が出て、条件が無いときは出ない', async () => {
    renderScreen()
    await chooseCsv(CSV)
    expect(screen.queryByRole('button', { name: 'すべての条件を解除' })).not.toBeInTheDocument()

    typeDescriptionFilter('セブン')

    expect(screen.getByRole('status', { name: '絞り込みの状況' })).toHaveTextContent('4件のうち2件を表示')
    expect(within(screen.getByRole('tab', { name: /^新規/ })).getByText('2 / 4')).toBeInTheDocument()
  })

  it('条件に合う行が無いときは、その旨を出し、条件を解除すれば戻せる', async () => {
    renderScreen()
    await chooseCsv(CSV)

    typeDescriptionFilter('存在しない店')

    expect(screen.getByText('条件に合う行がありません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('相手科目の絞り込みは、共通の選択欄で科目を選び、「未設定」で未入力の行だけを出せる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/新宿店/), '相手科目', '食費')
    pickIn(rowOf(/ローソン/), '相手科目', '食費')

    pickFilter('相手科目で絞り込み', '食費')
    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(false)

    pickFilter('相手科目で絞り込み', '未設定')
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(false)
  })

  it('プロジェクトの絞り込みは、選んだプロジェクトの行と、「未設定」の行を出し分けられる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/家賃/), 'プロジェクト', '出張')

    pickFilter('プロジェクトで絞り込み', '出張')
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(false)

    pickFilter('プロジェクトで絞り込み', '未設定')
    expect(hasRow(/家賃/)).toBe(false)
    expect(hasRow(/ローソン/)).toBe(true)
  })

  it('メンバーの絞り込みは、選んだメンバーの行と、「未設定」の行を出し分けられる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickMemberInRow(/ローソン/, '配偶者')

    pickFilter('メンバーで絞り込み', '配偶者')
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(false)

    pickFilter('メンバーで絞り込み', '未設定')
    expect(hasRow(/ローソン/)).toBe(false)
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('「すべての条件を解除」で、メンバーの条件も解除される', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickMemberInRow(/ローソン/, '配偶者')
    pickFilter('メンバーで絞り込み', '配偶者')
    expect(hasRow(/新宿店/)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))

    expect(hasRow(/新宿店/)).toBe(true)
  })

  it('複数の条件は、すべてに合う行だけを表示する(AND)', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/新宿店/), '相手科目', '食費')

    typeDescriptionFilter('セブン')
    pickFilter('相手科目で絞り込み', '食費')

    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(false)
    expect(screen.getByRole('status', { name: '絞り込みの状況' })).toHaveTextContent('2つの条件')
  })

  it('絞り込みで隠れた行のチェックは外れ、外した件数が一括設定の案内に出る。表示中の行のチェックは残る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))
    expect(within(screen.getByRole('group', { name: '選択した明細への一括設定' })).getByText('4件に一括設定')).toBeInTheDocument()

    typeDescriptionFilter('セブン')

    const bulk = screen.getByRole('group', { name: '選択した明細への一括設定' })
    expect(within(bulk).getByText('2件に一括設定')).toBeInTheDocument()
    expect(within(bulk).getByText(/絞り込みで隠れた行のチェック2件を外しました/)).toBeInTheDocument()
  })

  it('絞り込み中の一括設定は、表示中の行にだけ反映され、隠れた行は変わらない', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')
    fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))

    pickIn(within(screen.getByRole('group', { name: '選択した明細への一括設定' })), '一括の相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))

    expect(rowOf(/新宿店/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    expect(rowOf(/池袋店/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    expect(rowOf(/ローソン/).getByRole('button', { name: /^相手科目/ })).not.toHaveTextContent('食費')
  })

  it('確定の件数と確定は、絞り込み中は表示中の行だけが対象で、隠れた行は確定されず一覧に残る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    for (const desc of [/新宿店/, /池袋店/, /ローソン/, /家賃/]) pickIn(rowOf(desc), '相手科目', '食費')

    typeDescriptionFilter('セブン')
    expect(confirmButton(2)).toBeInTheDocument()
    fireEvent.click(confirmButton(2))

    await screen.findByText(/2件を確定しました/)
    expect(entries.findAll().filter((e) => e.sourceType !== 'auto_balance_adjustment')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(false)
  })

  it('絞り込みを解除すれば、確定の対象は全件に戻る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')
    expect(confirmButton(2)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'すべての条件を解除' }))

    expect(confirmButton(4)).toBeInTheDocument()
  })

  it('列見出しでの並び替えは、絞り込み中も表示中の行の中で効く', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')

    fireEvent.click(screen.getByRole('button', { name: /^日付/ }))
    fireEvent.click(screen.getByRole('button', { name: /^日付/ }))

    const names = screen.getAllByRole('row', { name: /店/ }).map((r) => r.textContent ?? '')
    expect(names[0]).toContain('池袋店')
    expect(names.some((n) => n.includes('ローソン'))).toBe(false)
  })

  it('絞り込み行の欄は列見出し(columnheader)ではなく、列の見出しは並び替えのボタンだけを持つ', async () => {
    renderScreen()
    await chooseCsv(CSV)

    const header = screen.getByRole('columnheader', { name: /^相手科目/ })
    expect(within(header).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryAllByRole('columnheader', { name: /絞り込み/ })).toHaveLength(0)
  })
})
