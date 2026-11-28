// @vitest-environment jsdom
/**
 * StatementImportScreen の行の絞り込み(計画Issue #258)のコンポーネントテスト。
 * 仕訳一覧と同じ作りの絞り込みパネル(摘要の検索・期間・金額(マイナスも指定できる)・相手科目/取引先/プロジェクト/世帯メンバー/精算バッチの複数選択欄と「未設定」)で行を絞れること、
 * 複数の条件がANDで効くこと、条件の解除で全行に戻ること、タブの件数が「表示中 / 全体」になること、
 * 表示されなくなった行(絞り込みで隠れた行・1ページ目に戻って見えなくなった行)のチェックが外れること、一括設定と確定が表示中の行だけに及ぶことを確認する。
 * 絞り込み欄の開閉(計画Issue #266)として、初期状態が閉じていること、タブの行のアイコンボタンでの開閉、閉じても条件が保たれ件数バッジが出ることも確認する
 * (既存のテストは panel() が閉じていれば開いてから使う)。
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
/** 一括編集のバーの「N行に適用」を押して、選んだ項目を反映する(計画Issue #300) */
const applyBulk = () =>
  fireEvent.click(within(screen.getByRole('group', { name: '選択した明細への一括設定' })).getByRole('button', { name: /^\d+行に適用$/ }))
/** 仕訳一覧と同じ作りの、明細の絞り込みパネル。初期状態は「閉」(計画Issue #266)なので、閉じていれば開いてから返す */
const panel = () => {
  const opener = screen.queryByRole('button', { name: /^絞り込みを開く/ })
  if (opener !== null) fireEvent.click(opener)
  return within(screen.getByRole('search', { name: '明細の絞り込み' }))
}
/** パネルの選択欄を開き、項目を選んで(複数選択なので開いたまま)閉じる。選び済みの項目を選ぶと外れる */
const chooseFilter = (label: string, ...items: string[]) => {
  const trigger = panel().getByRole('button', { name: new RegExp(`^${label}`) })
  fireEvent.click(trigger)
  const dialog = within(screen.getByRole('dialog', { name: label }))
  for (const item of items) fireEvent.click(dialog.getByRole('button', { name: new RegExp(`^${item}`) }))
  fireEvent.click(trigger)
}
/** 行の世帯メンバーの選択欄から選ぶ */
const pickMemberInRow = (rowText: RegExp, name: string) => {
  fireEvent.click(rowOf(rowText).getByRole('button', { name: /の世帯メンバー/ }))
  fireEvent.click(within(screen.getByRole('dialog', { name: /の世帯メンバー/ })).getByRole('button', { name }))
}
const typeDescriptionFilter = (text: string) =>
  fireEvent.change(panel().getByRole('searchbox', { name: '摘要で検索' }), { target: { value: text } })
const clearFilter = () => fireEvent.click(panel().getByRole('button', { name: '条件をクリア' }))
const confirmButton = (count: number) => screen.getByRole('button', { name: new RegExp(`^\\d+ / ${count} 件を「普通預金」に確定$`) })

describe('StatementImportScreen: 絞り込み欄の開閉(計画Issue #266)', () => {
  it('絞り込み欄は初期状態で閉じていて、タブの行のアイコンのボタンで開閉できる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    expect(screen.queryByRole('search', { name: '明細の絞り込み' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを開く' }))
    expect(screen.getByRole('search', { name: '明細の絞り込み' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }))
    expect(screen.queryByRole('search', { name: '明細の絞り込み' })).not.toBeInTheDocument()
  })

  it('開閉ボタンはタブ(tablist)と同じ行にあり、tablist の子ではない', async () => {
    renderScreen()
    await chooseCsv(CSV)
    const tabs = screen.getByRole('tablist')
    const toggle = screen.getByRole('button', { name: '絞り込みを開く' })
    expect(tabs.parentElement).toContainElement(toggle)
    expect(tabs).not.toContainElement(toggle)
  })

  it('閉じても入力済みの条件と絞り込みの結果は保たれ、ボタンの件数バッジで絞り込み中だと分かる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')
    fireEvent.click(screen.getByRole('button', { name: /^絞り込みを閉じる/ }))

    expect(screen.queryByRole('search', { name: '明細の絞り込み' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '絞り込みを開く(1件適用中)' })).toBeInTheDocument()
    expect(hasRow(/ローソン/)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /^絞り込みを開く/ }))
    expect(screen.getByRole('searchbox', { name: '摘要で検索' })).toHaveValue('セブン')
  })
})

describe('StatementImportScreen: 行の絞り込みパネル(計画Issue #258)', () => {
  it('摘要で検索すると、表記ゆれ(ハイフンの有無)を含めて該当する行だけが表示され、条件をクリアすると全行に戻る', async () => {
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

    clearFilter()

    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(panel().getByRole('searchbox', { name: '摘要で検索' })).toHaveValue('')
  })

  it('パネルに表示中の件数が出て、タブには「表示中 / 全体」が出る。条件が無いときは「条件をクリア」が出ない', async () => {
    renderScreen()
    await chooseCsv(CSV)
    expect(panel().queryByRole('button', { name: '条件をクリア' })).not.toBeInTheDocument()
    expect(panel().getByRole('status')).toHaveTextContent('4件')

    typeDescriptionFilter('セブン')

    expect(panel().getByRole('status')).toHaveTextContent('2件')
    expect(within(screen.getByRole('tab', { name: /^新規/ })).getByText('2 / 4')).toBeInTheDocument()
  })

  it('絞り込みは、表の中ではなく、表の外の独立したパネルにある(仕訳一覧と同じ)', async () => {
    renderScreen()
    await chooseCsv(CSV)

    expect(panel().getByRole('searchbox', { name: '摘要で検索' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('columnheader', { name: /絞り込み|検索/ })).toHaveLength(0)
    const header = screen.getByRole('columnheader', { name: /^相手科目/ })
    expect(within(header).getAllByRole('button')).toHaveLength(1)
  })

  it('条件に合う行が無いときは、その旨を出し、条件をクリアすれば戻せる', async () => {
    renderScreen()
    await chooseCsv(CSV)

    typeDescriptionFilter('存在しない店')

    expect(screen.getByText('条件に合う行がありません')).toBeInTheDocument()
    clearFilter()
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('相手科目は共通の選択欄(複数選択)で絞れ、「未設定」と一緒に選ぶと、どちらかに合う行が出る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/新宿店/), '相手科目', '食費')
    pickIn(rowOf(/ローソン/), '相手科目', '食費')

    chooseFilter('相手科目', '食費')
    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(false)

    chooseFilter('相手科目', '未設定')
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(true)
  })

  it('プロジェクトは、選んだプロジェクトの行と、「未設定」の行を出し分けられる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/家賃/), 'プロジェクト', '出張')

    chooseFilter('プロジェクト', '出張')
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(false)

    chooseFilter('プロジェクト', '出張', '未設定')
    expect(hasRow(/家賃/)).toBe(false)
    expect(hasRow(/ローソン/)).toBe(true)
  })

  it('世帯メンバーは、選んだメンバーの行と、「未設定」の行を出し分けられる', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickMemberInRow(/ローソン/, '配偶者')

    chooseFilter('世帯メンバー', '配偶者')
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(false)

    chooseFilter('世帯メンバー', '配偶者', '未設定')
    expect(hasRow(/ローソン/)).toBe(false)
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('「条件をクリア」で、選択欄の条件もすべて解除される', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickMemberInRow(/ローソン/, '配偶者')
    chooseFilter('世帯メンバー', '配偶者')
    expect(hasRow(/新宿店/)).toBe(false)

    clearFilter()

    expect(hasRow(/新宿店/)).toBe(true)
  })

  it('期間で絞り込むと、開始日・終了日を含む範囲の日付の行だけが表示される。片方だけの指定もできる', async () => {
    renderScreen()
    await chooseCsv(CSV)

    // 期間ははじめ月で選ぶ。日付で入れるには「日付で指定」にする(計画Issue #314)
    fireEvent.click(panel().getByRole('checkbox', { name: '日付で指定' }))
    fireEvent.change(panel().getByLabelText('期間の開始'), { target: { value: '2026-10-06' } })
    fireEvent.change(panel().getByLabelText('期間の終了'), { target: { value: '2026-10-07' } })
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(false)
    expect(hasRow(/家賃/)).toBe(false)
    expect(within(screen.getByRole('tab', { name: /^新規/ })).getByText('2 / 4')).toBeInTheDocument()

    fireEvent.change(panel().getByLabelText('期間の終了'), { target: { value: '' } })
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(false)
  })

  it('金額は符号つきのまま絞れて、マイナスの範囲も指定できる(支出はマイナス)', async () => {
    renderScreen()
    await chooseCsv(CSV)

    fireEvent.change(panel().getByLabelText('金額の上限'), { target: { value: '-500' } })
    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/ローソン/)).toBe(false)

    fireEvent.change(panel().getByLabelText('金額の下限'), { target: { value: '-1000' } })
    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(false)
  })

  it('プラスの金額で絞ると、支出(マイナス)の行は出ない', async () => {
    renderScreen()
    await chooseCsv(CSV)

    fireEvent.change(panel().getByLabelText('金額の下限'), { target: { value: '0' } })

    expect(screen.getByText('条件に合う行がありません')).toBeInTheDocument()
  })

  it('精算バッチは、選んだバッチの行と、「未割当」の行を出し分けられる', async () => {
    new SqlJsSettlementBatchRepository(db).create({ name: '10月の立替', type: 'expense_splitting' })
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/ローソン/), '相手科目', '立替金')
    fireEvent.click(rowOf(/ローソン/).getByRole('button', { name: /の精算バッチ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /の精算バッチ/ })).getByRole('button', { name: '10月の立替' }))

    chooseFilter('精算バッチ', '10月の立替')
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(false)

    chooseFilter('精算バッチ', '10月の立替', '未割当')
    expect(hasRow(/ローソン/)).toBe(false)
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('「条件をクリア」で、期間・金額の入力も空に戻る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    fireEvent.click(panel().getByRole('checkbox', { name: '日付で指定' }))
    fireEvent.change(panel().getByLabelText('期間の開始'), { target: { value: '2026-10-07' } })
    fireEvent.change(panel().getByLabelText('金額の下限'), { target: { value: '-1000' } })

    clearFilter()

    expect(panel().getByLabelText('期間の開始')).toHaveValue('')
    expect(panel().getByLabelText('金額の下限')).toHaveValue('')
    expect(hasRow(/家賃/)).toBe(true)
  })

  it('複数の軸の条件は、すべてに合う行だけを表示する(AND)', async () => {
    renderScreen()
    await chooseCsv(CSV)
    pickIn(rowOf(/新宿店/), '相手科目', '食費')

    typeDescriptionFilter('セブン')
    chooseFilter('相手科目', '食費')

    expect(hasRow(/新宿店/)).toBe(true)
    expect(hasRow(/池袋店/)).toBe(false)
  })

  it('表示されなくなった行(絞り込みで隠れた行)のチェックは外れ、外した件数が一括設定の案内に出る。表示中の行のチェックは残る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))
    expect(within(screen.getByRole('group', { name: '選択した明細への一括設定' })).getByText('4件に一括設定')).toBeInTheDocument()

    typeDescriptionFilter('セブン')

    const bulk = screen.getByRole('group', { name: '選択した明細への一括設定' })
    expect(within(bulk).getByText('2件に一括設定')).toBeInTheDocument()
    expect(within(bulk).getByText(/表示されなくなった行のチェック2件を外しました/)).toBeInTheDocument()
  })

  it('絞り込み中の一括設定は、表示中の行にだけ反映され、隠れた行は変わらない', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')
    fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))

    pickIn(within(screen.getByRole('group', { name: '選択した明細への一括設定' })), '一括の相手科目', '食費')
    applyBulk()
    clearFilter()

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
    clearFilter()
    expect(hasRow(/ローソン/)).toBe(true)
    expect(hasRow(/家賃/)).toBe(true)
    expect(hasRow(/新宿店/)).toBe(false)
  })

  it('絞り込みをクリアすれば、確定の対象は全件に戻る', async () => {
    renderScreen()
    await chooseCsv(CSV)
    typeDescriptionFilter('セブン')
    expect(confirmButton(2)).toBeInTheDocument()

    clearFilter()

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

  describe('絞り込み中でも、誤った行に作用しないこと(評価の指摘)', () => {
    const bulkGroup = () => screen.queryByRole('group', { name: '選択した明細への一括設定' })
    const leave = () => fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))
    const box = (text: RegExp) => screen.getByRole('checkbox', { name: text })

    it('入力で行が条件に合わなくなると(「未設定」で絞って科目を入れた行)、その行は見えなくなり、選択からも外れる', async () => {
      renderScreen()
      await chooseCsv(CSV)
      chooseFilter('相手科目', '未設定')
      fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))
      expect(within(bulkGroup()!).getByText('4件に一括設定')).toBeInTheDocument()

      pickIn(rowOf(/新宿店/), '相手科目', '食費')

      expect(hasRow(/新宿店/)).toBe(false)
      expect(within(bulkGroup()!).getByText('3件に一括設定')).toBeInTheDocument()
    })

    it('一括設定で、選んだ行がすべて条件外になると、選択がなくなって一括設定の帯が消え、隠れた行は変わらない', async () => {
      renderScreen()
      await chooseCsv(CSV)
      chooseFilter('相手科目', '未設定')
      fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))

      pickIn(within(bulkGroup()!), '一括の相手科目', '食費')
      applyBulk()

      expect(bulkGroup()).not.toBeInTheDocument()
      expect(screen.getByText('条件に合う行がありません')).toBeInTheDocument()
      clearFilter()
      for (const text of [/新宿店/, /池袋店/, /ローソン/, /家賃/]) {
        expect(rowOf(text).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
      }
    })

    it('絞り込み中の Shift+クリックの範囲選択は、表示中の行だけが対象で、間にある隠れた行は選ばれない', async () => {
      renderScreen()
      await chooseCsv(CSV)
      // 金額の上限 -500: 新宿店(-648)・池袋店(-520)・家賃(-50000)だけが残り、間のローソン(-432)が隠れる
      fireEvent.change(panel().getByLabelText('金額の上限'), { target: { value: '-500' } })
      expect(hasRow(/ローソン/)).toBe(false)

      fireEvent.click(box(/新宿店を選択/))
      fireEvent.click(box(/家賃を選択/), { shiftKey: true })
      expect(within(bulkGroup()!).getByText('3件に一括設定')).toBeInTheDocument()

      pickIn(within(bulkGroup()!), '一括の相手科目', '食費')
      applyBulk()
      clearFilter()
      expect(rowOf(/新宿店/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
      expect(rowOf(/家賃/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
      expect(rowOf(/ローソン/).getByRole('button', { name: /^相手科目/ })).not.toHaveTextContent('食費')
    })

    it('絞り込み中の確定で隠れた行が残るときは、「全件確定」の完了表示にならず、画面は初期化されず、残った行を続けて扱える', async () => {
      renderScreen()
      await chooseCsv(CSV)
      for (const desc of [/新宿店/, /池袋店/, /ローソン/, /家賃/]) pickIn(rowOf(desc), '相手科目', '食費')
      typeDescriptionFilter('セブン')

      fireEvent.click(confirmButton(2))

      await screen.findByText(/2件を確定しました/)
      expect(screen.queryByText('確定しました。続けて明細を選択してください。')).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /^新規/ })).toBeInTheDocument()
      clearFilter()
      expect(confirmButton(2)).toBeInTheDocument()
    })

    it('絞り込み中に離れる前の「一時保存して移動」を押すと、隠れた行も含めて、入力済みの全件を確定せず一時保存して移動する', async () => {
      renderScreen()
      await chooseCsv(CSV)
      pickIn(rowOf(/新宿店/), '相手科目', '食費')
      pickIn(rowOf(/ローソン/), '相手科目', '食費')
      typeDescriptionFilter('セブン')
      expect(hasRow(/ローソン/)).toBe(false)

      leave()
      fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
      expect(entries.findAll().filter((e) => e.sourceType !== 'auto_balance_adjustment')).toHaveLength(0)
      expect(new SqlJsStatementImportDraftRepository(db).findSummaries()[0]).toMatchObject({ filledRows: 2 })
    })

    it('重複の行の「取り込む」で別のタブの行へ移るときは、行き先を見失わないよう、絞り込みを解除する', async () => {
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      pickIn(rowOf(/スーパー/), '相手科目', '食費')
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
      await screen.findByText(/確定しました/)
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n`)
      fireEvent.click(await screen.findByRole('tab', { name: /^重複/ }))
      typeDescriptionFilter('スーパー')

      fireEvent.click(rowOf(/スーパー/).getByRole('button', { name: '取り込む' }))

      expect(panel().getByRole('searchbox', { name: '摘要で検索' })).toHaveValue('')
      expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('aria-selected', 'true')
      expect(hasRow(/スーパー/)).toBe(true)
      expect(hasRow(/ランチ/)).toBe(true)
    })
  })
})
