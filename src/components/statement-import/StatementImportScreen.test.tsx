// @vitest-environment jsdom
/**
 * StatementImportScreen(明細取込画面、計画Issue #151)のコンポーネントテスト。
 * アップロードとレビューを1画面にまとめた画面: CSVの選択、全マッピング定義への実パース試行による絞り込み
 * (1つなら自動選択・複数なら選択)、定義に紐づく科目を初期値にした取込先の確認と変更(紐づく科目が無ければ
 * 選ぶまで一覧を出さない、取り込むと紐づけを追加)、一致する定義が無いときの画面内での定義の作成、1件1行の一覧、キーワードルールによる取引先・相手科目の推定と
 * (キーワードに紐づく科目の)初期入力、重複の行(入力・選択なし、「取り込む」で戻せる)、選択した行への一括設定
 * (対象外の件数)、確定版の候補の置き換え、残高照合、確定、確定後に続けて次のCSVを
 * 取り込めることを、sql.jsのNode実装(createTestDatabase)を使って確認する。
 * CSVを選ぶ前の画面中央の「CSVを選択」ボタンと、編集中に新しいCSVを選ぼうとしたときの警告(計画Issue #193)、
 * 編集中に他の画面へ移ろうとしたときの未保存の警告(保存して移動・破棄して移動・キャンセル・設定オフ、計画Issue #193)も確認する。
 * 計画Issue #259: 相手科目・取引先それぞれのキーワードのアイコンとポップアップ(一致の強調・入力を終えたときと閉じる操作での保存・
 * キーワードごとの「N行に適用」)と、摘要の自動学習をしないことも確認する。
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
import { chooseBatch, expectBatch, findBatchButton, queryBatchButton } from '../master/batchSelectTestHelpers'
import { chooseMember, expectMember, findMemberButton, listMemberOptions } from '../master/memberSelectTestHelpers'
import { StatementImportScreen } from './StatementImportScreen'
import { IMPORT_PAGE_SIZE } from './importTabs'
import { chooseTargetAccount, expectTargetAccount, findTargetAccountButton } from './targetAccountTestHelpers'

let db: Database
let accounts: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository
let counterparties: SqlJsCounterpartyRepository
let keywordRules: SqlJsKeywordRuleRepository
let projects: SqlJsProjectRepository
let mappings: SqlJsImportMappingDefinitionRepository
let batches: SqlJsSettlementBatchRepository
let memberId: number
let bank: ReturnType<SqlJsAccountRepository['create']>
let food: ReturnType<SqlJsAccountRepository['create']>
let onEditMappings: () => void

/** 利用者が作った仕訳(取引後残高の基準点から自動で入る調整仕訳は除く、計画Issue #205) */
function userEntries() {
  return entries.findAll().filter((e) => e.sourceType !== 'auto_balance_adjustment')
}

beforeEach(async () => {
  localStorage.clear()
  db = await createTestDatabase()
  runMigrations(db)
  // 取引後残高付きの取込は基準点になり、自動調整仕訳の相手科目が必要になる(計画Issue #205)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  keywordRules = new SqlJsKeywordRuleRepository(db)
  projects = new SqlJsProjectRepository(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
  batches = new SqlJsSettlementBatchRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  bank = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
  onEditMappings = vi.fn()
})

afterEach(cleanup)

function renderScreen(
  householdMemberRepository: Pick<SqlJsHouseholdMemberRepository, 'findAll'> = new SqlJsHouseholdMemberRepository(db),
  counterpartyRepository: SqlJsCounterpartyRepository = counterparties,
  keywordRuleRepository: SqlJsKeywordRuleRepository = keywordRules,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
      <StatementImportScreen
        accountRepository={accounts}
        accountGroupRepository={new SqlJsAccountGroupRepository(db)}
        importMappingDefinitionRepository={mappings}
        externalTransactionRefRepository={new SqlJsExternalTransactionRefRepository(db)}
        journalEntryRepository={entries}
        counterpartyRepository={counterpartyRepository}
        keywordRuleRepository={keywordRuleRepository}
        counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
        projectRepository={projects}
        projectGroupRepository={new SqlJsProjectGroupRepository(db)}
        householdMemberRepository={householdMemberRepository}
        settlementBatchRepository={batches}
        statementImportDraftRepository={new SqlJsStatementImportDraftRepository(db)}
        onEditMappings={onEditMappings}
      />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

function makeMapping(overrides: Partial<Parameters<typeof mappings.create>[0]> = {}) {
  return mappings.create({
    formatGroupId: 'my-bank',
    label: 'マイ銀行',
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    balanceColumn: '残高',
    // 既定は普通預金に紐づく定義(取込先の初期値になる)
    accountIds: [bank.id],
    ...overrides,
  })
}

const HEADER = '日付,摘要,金額,残高\n'
const csvFile = (content: string, name = 'statement.csv') => new File([content], name, { type: 'text/csv' })

/** CSVを選ぶ(取込先は定義に紐づく科目が初期値になる)。waitLoadedがtrue(既定)なら、一覧が表示されるまで待つ */
async function chooseCsv(content: string, waitLoaded = true) {
  fireEvent.change(await screen.findByLabelText('CSVを選択'), { target: { files: [csvFile(content)] } })
  if (waitLoaded) {
    await screen.findByText(/statement\.csv を読み込み済み/)
    // 科目に名義が無いときは「誰の明細か」を選ばないと確定できない(計画Issue #193)ので、既定では memberId の人を選んでおく
    if (screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })) chooseMember('誰の明細か(必須)', '自分')
  }
}

/** 補助行(確定版の確認・キーワード登録)にも同じ摘要の文字列が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
/** 一括設定のバナー。プロジェクト・世帯メンバー・精算バッチ・コメントは「その他の項目」を開くと出る(計画Issue #266)ので、開いてから返す */
const openBulkGroup = () => {
  const group = screen.getByRole('group', { name: '選択した明細への一括設定' })
  const more = within(group).getByRole('button', { name: /^その他の項目/ })
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
  return within(group)
}
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

/** 行の取引先のキーワードのアイコン(計画Issue #259)を押してポップアップを開く。開いたあとのポップアップは settings() で、操作のたびに取り直して使う */
async function openCounterpartySettings(desc: string) {
  fireEvent.click(rowOf(new RegExp(desc)).getByRole('button', { name: `${desc}の取引先のキーワード` }))
  await screen.findByRole('dialog', { name: /^取引先「.*」のキーワード$/ })
}
const settings = () => within(screen.getByRole('dialog', { name: /^取引先「.*」のキーワード$/ }))
/** 一覧のタブ(新規・重複・取り込まない行、計画Issue #263)を開く */
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
const confirmButton = (count: number) => screen.getByRole('button', { name: new RegExp(`^\\d+ / ${count} 件を「普通預金」に確定$`) })

/** ダイアログの金融機関名欄で「新しい金融機関名を入力…」を選び、名前を入力する */
function enterInstitution(dialog: ReturnType<typeof within>, name: string) {
  fireEvent.change(dialog.getByLabelText('金融機関名'), { target: { value: '__new__' } })
  fireEvent.change(dialog.getByLabelText('新しい金融機関名'), { target: { value: name } })
}

describe('StatementImportScreen', () => {
  it('CSVを選ぶと、定義に紐づく取込先が初期値になり、同じ画面に1件1行で日付・摘要・金額・状態が表示され、件数が要約される', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n`)

    const row = rowOf(/スーパー/)
    expect(await screen.findByText(/statement\.csv を読み込み済み。新規 2 件、重複で除外 0 件、確認が必要 2 件/)).toBeInTheDocument()
    expect(row.getByText('2026/10/05')).toBeInTheDocument()
    expect(row.getByText('-¥3,000')).toBeInTheDocument()
    expect(row.getByText('要確認')).toBeInTheDocument()
  })

  it('一致する定義が無いときは、その旨を表示する', async () => {
    makeMapping({ dateColumn: '存在しない列' })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    expect(await screen.findByRole('alert')).toHaveTextContent('に一致するマッピングが見つかりませんでした')
  })

  it('取引先と相手科目は、一致したキーワードに紐づくものがそのまま初期値として入る(計画Issue #219)', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'セブン' })
    keywordRules.create({ pattern: 'セブンイレブン', counterpartyId: cp.id, accountId: food.id })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,セブンイレブン 新宿,-640,99360\n`)

    const row = rowOf(/セブンイレブン/)
    expect(await row.findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^取引先: セブン/ })).toBeInTheDocument()
    expect(row.getByText('新規')).toBeInTheDocument()
  })

  it('摘要に複数のキーワードが別々の取引先で一致したら、自動では入れず、取引先欄の先頭に一致した候補を並べる(計画Issue #236)', async () => {
    makeMapping()
    const metro = counterparties.create({ name: '東京メトロ' })
    const jr = counterparties.create({ name: 'ジェイアール東日本' })
    // どちらも3文字のキーワードで、使用件数も同じなので、名前の五十音順(ジェイアール東日本 → 東京メトロ)に並ぶ
    keywordRules.create({ pattern: 'スイカ', counterpartyId: metro.id })
    keywordRules.create({ pattern: 'ジエイ', counterpartyId: jr.id })
    counterparties.create({ name: '関係のない店' })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,ジェイアール スイカ チャージ,-3000,97000
`)

    const row = rowOf(/スイカ チャージ/)
    expect(await row.findByText('候補2件から選択')).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^取引先: 指定なし|^取引先: 取引先なし/ })).toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: /^取引先/ }))
    const popup = within(screen.getByRole('dialog', { name: '取引先' }))
    expect(popup.getByText('この摘要に一致した候補')).toBeInTheDocument()
    const names = popup.getAllByRole('button').map((b) => b.textContent)
    const firstJr = names.indexOf('ジェイアール東日本')
    const firstMetro = names.indexOf('東京メトロ')
    expect(firstJr).toBeGreaterThanOrEqual(0)
    expect(firstJr).toBeLessThan(firstMetro)
    // 候補の下に、標準のマスタ表示(関係のない店も含む)が続く
    expect(popup.getByRole('button', { name: '関係のない店' })).toBeInTheDocument()
    // 候補を選ぶと、その取引先が入る
    fireEvent.click(popup.getAllByRole('button', { name: '東京メトロ' })[0])
    expect(row.getByRole('button', { name: /^取引先: 東京メトロ/ })).toBeInTheDocument()
  })

  it('摘要に複数のキーワードが別々の科目で一致したら、自動では入れず、相手科目欄の先頭にも一致した候補を並べる(計画Issue #260)', async () => {
    makeMapping()
    const transport = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    accounts.create({ category: 'expense', name: '雑費', isReconcilable: null })
    const metro = counterparties.create({ name: '東京メトロ' })
    const jr = counterparties.create({ name: 'ジェイアール東日本' })
    // 互いに包含しない独立したキーワードが重なり、取引先も科目も別々なので曖昧になる
    keywordRules.create({ pattern: 'スイカ', counterpartyId: metro.id, accountId: transport.id })
    keywordRules.create({ pattern: 'ジエイ', counterpartyId: jr.id, accountId: food.id })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,ジェイアール スイカ チャージ,-3000,97000
`)

    const row = rowOf(/スイカ チャージ/)
    expect(await row.findByText('科目の候補2件から選択')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: /^相手科目: 交通費|^相手科目: 食費/ })).not.toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: /^相手科目/ }))
    const popup = within(screen.getByRole('dialog', { name: '相手科目' }))
    expect(popup.getByText('この摘要に一致した候補')).toBeInTheDocument()
    const names = popup.getAllByRole('button').map((b) => b.textContent)
    const firstTransport = names.indexOf('交通費')
    const firstFood = names.indexOf('食費')
    const firstMisc = names.indexOf('雑費')
    expect(firstTransport).toBeGreaterThanOrEqual(0)
    expect(firstFood).toBeGreaterThanOrEqual(0)
    // 候補(交通費・食費)が、関係のない科目(雑費)より先に並ぶ
    expect(Math.max(firstTransport, firstFood)).toBeLessThan(firstMisc)
    // 候補を選ぶと、その科目が入る
    fireEvent.click(popup.getAllByRole('button', { name: '交通費' })[0])
    expect(row.getByRole('button', { name: /^相手科目: 交通費/ })).toBeInTheDocument()
  })

  it('科目だけのキーワードと取引先つきのキーワードが独立して重なったら、取引先も相手科目も自動では入れず、取引先欄は隠れずに選べる(計画Issue #260)', async () => {
    makeMapping()
    const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
    const seven = counterparties.create({ name: 'セブン銀行' })
    keywordRules.create({ pattern: 'セブン銀行', counterpartyId: seven.id })
    keywordRules.create({ pattern: 'ATM', accountId: cash.id })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,セブン銀行ATM 引出,-10000,90000
`)

    const row = rowOf(/セブン銀行ATM/)
    // 取引先が黙って空になり、取引先欄ごと隠れるのではなく、どちらも空のまま、取引先欄が出ている
    expect(await row.findByText('科目の候補1件から選択')).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^取引先/ })).toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: /^取引先/ }))
    expect(within(screen.getByRole('dialog', { name: '取引先' })).getByText('この摘要に一致した候補')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: '取引先' })).getAllByRole('button', { name: 'セブン銀行' })[0])
    expect(row.getByRole('button', { name: /^取引先: セブン銀行/ })).toBeInTheDocument()
  })

  it('一致したキーワードのうち最長のものが他のすべてを含むときは、そのルールの取引先・科目が自動で入る(AMAZON PRIME ⊃ AMAZON。計画Issue #260)', async () => {
    makeMapping()
    const transport = accounts.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const amazon = counterparties.create({ name: 'アマゾン' })
    const prime = counterparties.create({ name: 'アマゾンプライム' })
    keywordRules.create({ pattern: 'AMAZON', counterpartyId: amazon.id, accountId: food.id })
    keywordRules.create({ pattern: 'AMAZONPRIME', counterpartyId: prime.id, accountId: transport.id })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,AMAZON PRIME 会費,-600,99400
`)

    const row = rowOf(/AMAZON PRIME/)
    expect(await row.findByRole('button', { name: /^取引先: アマゾンプライム/ })).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^相手科目: 交通費/ })).toBeInTheDocument()
    expect(row.queryByText(/候補.*件から選択/)).not.toBeInTheDocument()
  })

  it('キーワードに科目が無ければ、取引先だけが入り、相手科目は空のまま(取引先から科目を補わない。計画Issue #219)', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'セブン' })
    keywordRules.create({ pattern: 'セブンイレブン', counterpartyId: cp.id })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,セブンイレブン 新宿,-640,99360\n`)

    const row = rowOf(/セブンイレブン/)
    expect(await row.findByRole('button', { name: /^取引先: セブン/ })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: /^相手科目: 食費/ })).not.toBeInTheDocument()
    expect(row.getByText('要確認')).toBeInTheDocument()
  })

  it('取引先を手で選んでも、相手科目は自動で入らない(科目はキーワードに紐づくものだけ。計画Issue #219)', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'セブン' })
    keywordRules.create({ pattern: 'セブンイレブン', counterpartyId: cp.id, accountId: food.id })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,コンビニ 新宿,-640,99360\n`)

    pick(rowOf(/コンビニ/), '取引先', 'セブン')

    expect(rowOf(/コンビニ/).queryByRole('button', { name: /^相手科目: 食費/ })).not.toBeInTheDocument()
  })

  it('重複の行は入力欄も選択も出ず「対象外」と表示され、「取り込む」で新規に戻せる', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    // 重複の行は「重複」タブにある(計画Issue #263)
    fireEvent.click(await screen.findByRole('tab', { name: /^重複/ }))
    const row = rowOf(/スーパー/)
    expect(await row.findByText('取り込み済みのため対象外です')).toBeInTheDocument()
    expect(row.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(row.queryByLabelText('スーパーのコメント')).not.toBeInTheDocument()
    expect(row.getByText('重複・除外')).toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: '取り込む' }))

    // 取り込むと、行は「新規」タブへ移り、そのタブが開いて行を見失わない
    expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('aria-selected', 'true')
    expect(rowOf(/スーパー/).getByLabelText('スーパーのコメント')).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByText('要確認')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^重複/ })).not.toBeInTheDocument()
  })

  it('一括設定のバナー: コメントのボタンは「コメントを適用」で、「選択を解除」は右端に寄せ、ほかの入力・ボタンと同じ高さの部品を使う', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
    fireEvent.click(screen.getByLabelText('スーパーを選択'))

    const bulk = openBulkGroup()

    expect(bulk.getByRole('button', { name: 'コメントを適用' })).toBeInTheDocument()
    expect(bulk.queryByRole('button', { name: 'コメントを設定' })).not.toBeInTheDocument()
    // 件数の見出しは本文と同じ大きさの専用クラス、「選択を解除」は右寄せの専用クラス、ボタンは入力欄と同じ高さ(small ではない)
    expect(bulk.getByText('1件に一括設定')).toHaveClass('import-bulk__count')
    expect(bulk.getByRole('button', { name: '選択を解除' })).toHaveClass('import-bulk__clear')
    expect(bulk.getByRole('button', { name: 'コメントを適用' })).not.toHaveClass('import-btn--small')
    expect(bulk.getByRole('button', { name: '選択を解除' })).not.toHaveClass('import-btn--small')
  })

  /**
   * 計画Issue #266: 一括設定のバナーは選んだときだけ出る(領域の確保や案内は出さない)。最初のチェックで表の枠が下がっても、
   * 行が動かないようスクロール位置を相殺する(相殺は useKeepRowsInPlace のテストと、実ブラウザの E2E で検証する)。
   * タブの行・絞り込み欄は上部に固定し、表は画面に収まるスクロールの枠にして見出しを固定する。
   */
  describe('バナーの出入りと上部への固定(計画Issue #266)', () => {
    it('未選択のときは、一括設定の領域も案内も出さない。選んだときだけバナーが出る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

      expect(screen.queryByTestId('import-bulk-slot')).not.toBeInTheDocument()
      expect(screen.queryByText(/行にチェックを付けると/)).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '選択した明細への一括設定' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('スーパーを選択'))

      expect(screen.getByRole('group', { name: '選択した明細への一括設定' })).toBeInTheDocument()
    })

    it('バナーは、表(スクロールの枠)の外にある(バナーは枠の中でスクロールされない)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      fireEvent.click(screen.getByLabelText('スーパーを選択'))

      const scrollRegion = screen.getByRole('table').closest('.import-table-wrap') as HTMLElement
      expect(scrollRegion).not.toBeNull()
      expect(scrollRegion).not.toContainElement(screen.getByRole('group', { name: '選択した明細への一括設定' }))
    })
    it('バナーは1行にまとめ、相手科目と取引先だけを出す。プロジェクト・世帯メンバー・精算バッチ・コメントは「その他の項目」を開くと出る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      fireEvent.click(screen.getByLabelText('スーパーを選択'))
      const group = () => within(screen.getByRole('group', { name: '選択した明細への一括設定' }))

      expect(group().getByRole('button', { name: /^一括の相手科目/ })).toBeInTheDocument()
      expect(group().getByRole('button', { name: /^一括の取引先/ })).toBeInTheDocument()
      expect(group().queryByRole('button', { name: /^一括のプロジェクト/ })).not.toBeInTheDocument()
      expect(group().queryByLabelText('一括で設定するコメント')).not.toBeInTheDocument()
      expect(group().getByRole('button', { name: /^その他の項目/ })).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(group().getByRole('button', { name: /^その他の項目/ }))

      expect(group().getByRole('button', { name: /^一括のプロジェクト/ })).toBeInTheDocument()
      expect(group().getByLabelText('一括で設定するコメント')).toBeInTheDocument()
      expect(group().getByRole('button', { name: 'コメントを適用' })).toBeInTheDocument()
      expect(group().getByRole('button', { name: /^その他の項目/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('タブの行と絞り込み欄は、ひとつの固定の容器にまとまっている(絞り込み欄を開いても同じ容器)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

      const sticky = screen.getByRole('tablist').closest('.import-sticky')
      expect(sticky).not.toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '絞り込みを開く' }))
      expect(within(sticky as HTMLElement).getByRole('search', { name: '明細の絞り込み' })).toBeInTheDocument()
    })
  })

  it('選択した行に一括設定でき、設定できなかった行は対象外の件数で伝える', async () => {
    makeMapping()
    const trip = projects.create({ name: '沖縄旅行' })
    batches.create({ name: '10月の立替', type: 'expense_splitting' })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    pick(rowOf(/ランチ/), '相手科目', '立替金')

    fireEvent.click(screen.getByLabelText('スーパーを選択'))
    fireEvent.click(screen.getByLabelText('ランチを選択'))
    const bulk = openBulkGroup()
    expect(bulk.getByText('2件に一括設定')).toBeInTheDocument()
    chooseBatch('精算バッチを一括設定', '10月の立替', bulk)

    expect(bulk.getByText('1件に設定しました(1件は対象外)')).toBeInTheDocument()
    expectBatch('ランチの精算バッチ', '10月の立替', rowOf(/ランチ/))

    pick(bulk, '一括のプロジェクト', '沖縄旅行')
    expect(bulk.getByText('2件に設定しました')).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByRole('button', { name: new RegExp(`^プロジェクト: ${trip.name}`) })).toBeInTheDocument()
  })

  /**
   * 明細の範囲選択・トグル選択(計画Issue #235 D): 明細の行のチェックを、Shift+クリックで範囲選択、Ctrl/Cmd+クリックでトグル、
   * チェックにフォーカスしての Shift+↑↓で範囲を広げられる。範囲は画面に見える順(グループ・並び替え後)で、重複の行(チェックなし)は含まない。
   */
  describe('明細の範囲選択・トグル選択(計画Issue #235 D)', () => {
    const FOUR_ROWS = `${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n2026/10/07,カフェ,-500,95700\n2026/10/08,書店,-1500,94200\n`
    const box = (desc: string) => screen.getByLabelText(`${desc}を選択`) as HTMLInputElement
    const countText = (n: number) => `${n}件に一括設定`

    it('Shift+クリックで、直前に選んだ行から押した行までの明細が選択に加わる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      fireEvent.click(box('カフェ'), { shiftKey: true })
      const bulk = within(screen.getByRole('group', { name: '選択した明細への一括設定' }))
      expect(bulk.getByText(countText(3))).toBeInTheDocument()
      expect(box('ランチ').checked).toBe(true)
      expect(box('書店').checked).toBe(false)
    })

    it('Ctrl+クリックで離れた行を選択に加え、Cmd+クリックでその行だけ外せる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      fireEvent.click(box('書店'), { ctrlKey: true })
      const bulk = within(screen.getByRole('group', { name: '選択した明細への一括設定' }))
      expect(bulk.getByText(countText(2))).toBeInTheDocument()
      expect(box('ランチ').checked).toBe(false)
      fireEvent.click(box('スーパー'), { metaKey: true })
      expect(bulk.getByText(countText(1))).toBeInTheDocument()
    })

    it('チェックにフォーカスして Shift+↓ を押すと、次の行までが選ばれ、フォーカスが次の行のチェックへ移る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      box('ランチ').focus()
      fireEvent.keyDown(box('ランチ'), { key: 'ArrowDown', shiftKey: true })
      expect(box('ランチ').checked).toBe(true)
      expect(box('カフェ').checked).toBe(true)
      expect(box('カフェ')).toHaveFocus()
    })

    it('Ctrl+行の摘要などの文字部分を押すと、その行のチェックが切り替わる(Cmd でも同じ)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      const row = box('ランチ').closest('tr') as HTMLElement
      fireEvent.click(row.querySelector('.import-desc') as HTMLElement, { ctrlKey: true })
      expect(box('ランチ').checked).toBe(true)
      fireEvent.click(row.querySelector('.import-desc') as HTMLElement, { metaKey: true })
      expect(box('ランチ').checked).toBe(false)
    })

    it('Ctrl+行の中のボタン(相手科目の選択欄など)を押したときは、チェックを切り替えず、その部品の操作に任せる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      const row = box('ランチ').closest('tr') as HTMLElement
      fireEvent.click(within(row).getByRole('button', { name: /^相手科目/ }), { ctrlKey: true })
      expect(box('ランチ').checked).toBe(false)
    })

    it('チェックが1件でもあるときは、Ctrl を押さなくても、別の行の文字部分を押すとチェックが切り替わる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      const row = box('カフェ').closest('tr') as HTMLElement
      fireEvent.click(row.querySelector('.import-desc') as HTMLElement)
      expect(box('カフェ').checked).toBe(true)
      fireEvent.click(row.querySelector('.import-desc') as HTMLElement)
      expect(box('カフェ').checked).toBe(false)
    })

    it('チェックが1件でもあるときも、行の中のボタン(相手科目の選択欄など)は、チェックを切り替えず、その部品の操作に任せる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      const row = box('ランチ').closest('tr') as HTMLElement
      fireEvent.click(within(row).getByRole('button', { name: /^相手科目/ }))
      expect(box('ランチ').checked).toBe(false)
    })

    it('Ctrl を押さずに行の文字部分を押しても、チェックは変わらない', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      const row = box('ランチ').closest('tr') as HTMLElement
      fireEvent.click(row.querySelector('.import-desc') as HTMLElement)
      expect(box('ランチ').checked).toBe(false)
    })

    it('選択したあとに Esc を押すと、選択がすべて解除され、一括設定のバナーが消える', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      fireEvent.click(box('カフェ'), { shiftKey: true })
      expect(screen.getByRole('group', { name: '選択した明細への一括設定' })).toBeInTheDocument()
      box('カフェ').focus()
      fireEvent.keyDown(box('カフェ'), { key: 'Escape' })
      expect(screen.queryByRole('group', { name: '選択した明細への一括設定' })).not.toBeInTheDocument()
      expect(box('スーパー').checked).toBe(false)
    })

    it('範囲選択のあとに「選択を解除」すると選択が空になり、次の Shift+クリックはその行だけを選ぶ', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(FOUR_ROWS)
      fireEvent.click(box('スーパー'))
      fireEvent.click(within(screen.getByRole('group', { name: '選択した明細への一括設定' })).getByRole('button', { name: '選択を解除' }))
      fireEvent.click(box('書店'), { shiftKey: true })
      expect(box('書店').checked).toBe(true)
      expect(box('ランチ').checked).toBe(false)
      expect(box('スーパー').checked).toBe(false)
    })
  })

  describe('世帯メンバーの選択欄(計画Issue #234)', () => {
    const TWO_ROWS = `${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
`
    const bulkGroup = () => openBulkGroup()

    it('一括設定で世帯メンバーを選ぶと、選択した全行に反映される(選択しなかった行は変わらない)', async () => {
      makeMapping()
      new SqlJsHouseholdMemberRepository(db).create({ name: '花子' })
      renderScreen()
      await chooseCsv(`${TWO_ROWS}2026/10/07,家賃,-50000,46200
`)
      fireEvent.click(screen.getByLabelText('スーパーを選択'))
      fireEvent.click(screen.getByLabelText('ランチを選択'))

      chooseMember('世帯メンバーを一括設定', '花子', bulkGroup())

      expectMember('スーパーの世帯メンバー', '花子', rowOf(/スーパー/))
      expectMember('ランチの世帯メンバー', '花子', rowOf(/ランチ/))
      expectMember('家賃の世帯メンバー', 'なし', rowOf(/家賃/))
    })

    it('一括設定の「なし(クリア)」を選ぶと、選択した全行の世帯メンバーが未設定に戻る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(TWO_ROWS)
      fireEvent.click(screen.getByLabelText('スーパーを選択'))
      fireEvent.click(screen.getByLabelText('ランチを選択'))
      chooseMember('世帯メンバーを一括設定', '自分', bulkGroup())
      expectMember('スーパーの世帯メンバー', '自分', rowOf(/スーパー/))

      chooseMember('世帯メンバーを一括設定', 'なし(クリア)', bulkGroup())

      expectMember('スーパーの世帯メンバー', 'なし', rowOf(/スーパー/))
      expectMember('ランチの世帯メンバー', 'なし', rowOf(/ランチ/))
    })

    it('行ごとに世帯メンバーを選ぶと、その行だけが変わる', async () => {
      makeMapping()
      new SqlJsHouseholdMemberRepository(db).create({ name: '花子' })
      renderScreen()
      await chooseCsv(TWO_ROWS)

      chooseMember('ランチの世帯メンバー', '花子', rowOf(/ランチ/))

      expectMember('ランチの世帯メンバー', '花子', rowOf(/ランチ/))
      expectMember('スーパーの世帯メンバー', 'なし', rowOf(/スーパー/))
    })

    it('相手科目に既定の世帯メンバーがある行は、そのメンバーを出して選べない', async () => {
      makeMapping()
      accounts.create({ category: 'asset', name: '夫の財布', isReconcilable: false, householdMemberId: memberId })
      renderScreen()
      await chooseCsv(TWO_ROWS)

      pick(rowOf(/スーパー/), '相手科目', '夫の財布')

      expectMember('スーパーの世帯メンバー', '自分', rowOf(/スーパー/))
      expect(findMemberButton('スーパーの世帯メンバー', rowOf(/スーパー/))).toBeDisabled()
      expect(findMemberButton('ランチの世帯メンバー', rowOf(/ランチ/))).toBeEnabled()
    })

    it('「誰の明細か」は、未選択のあいだ囲みに強調のクラスが付き、選ぶと外れる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(TWO_ROWS, false)
      await chooseTargetAccount(bank.name)
      await screen.findByText(/statement.csv を読み込み済み/)

      expect(findMemberButton('誰の明細か(必須)').closest('.import-attention')).not.toBeNull()
      chooseMember('誰の明細か(必須)', '自分')
      expect(findMemberButton('誰の明細か(必須)').closest('.import-attention')).toBeNull()
    })
  })

  describe('精算バッチの選択欄(計画Issue #234)', () => {
    const TWO_ROWS = `${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n`
    const bulkGroup = () => openBulkGroup()

    it('一括設定で精算バッチを選ぶと選択した行に付き、「なし(クリア)」で外れる', async () => {
      makeMapping()
      batches.create({ name: '10月の立替', type: 'expense_splitting' })
      renderScreen()
      await chooseCsv(TWO_ROWS)
      pick(rowOf(/スーパー/), '相手科目', '立替金')
      pick(rowOf(/ランチ/), '相手科目', '立替金')
      fireEvent.click(screen.getByLabelText('スーパーを選択'))
      fireEvent.click(screen.getByLabelText('ランチを選択'))

      chooseBatch('精算バッチを一括設定', '10月の立替', bulkGroup())
      expectBatch('スーパーの精算バッチ', '10月の立替', rowOf(/スーパー/))
      expectBatch('ランチの精算バッチ', '10月の立替', rowOf(/ランチ/))

      chooseBatch('精算バッチを一括設定', 'なし(クリア)', bulkGroup())
      expectBatch('スーパーの精算バッチ', '精算バッチなし', rowOf(/スーパー/))
      expectBatch('ランチの精算バッチ', '精算バッチなし', rowOf(/ランチ/))
    })

    it('行ごとに精算バッチを選ぶと、その行だけが変わる', async () => {
      makeMapping()
      batches.create({ name: '10月の立替', type: 'expense_splitting' })
      renderScreen()
      await chooseCsv(TWO_ROWS)
      pick(rowOf(/スーパー/), '相手科目', '立替金')
      pick(rowOf(/ランチ/), '相手科目', '立替金')

      chooseBatch('ランチの精算バッチ', '10月の立替', rowOf(/ランチ/))

      expectBatch('ランチの精算バッチ', '10月の立替', rowOf(/ランチ/))
      expectBatch('スーパーの精算バッチ', '精算バッチなし', rowOf(/スーパー/))
    })

    it('行の選択欄の「+ 新しいバッチ」で名前を入れて追加すると、バッチが作られてその行に選ばれる(計画Issue #269)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(TWO_ROWS)
      pick(rowOf(/スーパー/), '相手科目', '立替金')
      pick(rowOf(/ランチ/), '相手科目', '立替金')

      fireEvent.click(findBatchButton('ランチの精算バッチ', rowOf(/ランチ/)))
      fireEvent.click(screen.getByRole('button', { name: '+ 新しいバッチ' }))
      fireEvent.change(screen.getByLabelText('バッチ名'), { target: { value: '12月の忘年会' } })
      fireEvent.click(screen.getByRole('button', { name: '追加' }))

      await waitFor(() => expectBatch('ランチの精算バッチ', '12月の忘年会', rowOf(/ランチ/)))
      expect(batches.findAll().map((b) => b.name)).toEqual(['12月の忘年会'])
      expectBatch('スーパーの精算バッチ', '精算バッチなし', rowOf(/スーパー/))
    })

    it('行の「+ 新しいバッチ」をキャンセルすると、バッチは作られず選択も変わらない(計画Issue #269)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(TWO_ROWS)
      pick(rowOf(/ランチ/), '相手科目', '立替金')

      fireEvent.click(findBatchButton('ランチの精算バッチ', rowOf(/ランチ/)))
      fireEvent.click(screen.getByRole('button', { name: '+ 新しいバッチ' }))
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

      expect(batches.findAll()).toEqual([])
      expectBatch('ランチの精算バッチ', '精算バッチなし', rowOf(/ランチ/))
    })
  })

  it('精算バッチは立替金・未払金の行だけに出て、利用者が作った資産(有価証券など)の行には出ない', async () => {
    makeMapping()
    accounts.create({ category: 'asset', name: '有価証券', isReconcilable: false })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
`)

    pick(rowOf(/スーパー/), '相手科目', '有価証券')
    pick(rowOf(/ランチ/), '相手科目', '立替金')

    expect(queryBatchButton('スーパーの精算バッチ', rowOf(/スーパー/))).toBeNull()
    expect(findBatchButton('ランチの精算バッチ', rowOf(/ランチ/))).toBeInTheDocument()
  })

  it('確定すると仕訳が作られ、同じ画面で続けて次のCSVを取り込める', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.change(rowOf(/スーパー/).getByLabelText('スーパーのコメント'), { target: { value: 'まとめ買い' } })

    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

    expect(await screen.findByText(/確定しました。続けて明細を選択してください。/)).toBeInTheDocument()
    const created = userEntries()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ comment: 'まとめ買い', sourceType: 'external_import' })
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
    // 画面を取り込み前の状態に戻し、明細の再選択を促す(確定ボタン・取込先などは残さない)
    expect(screen.getByRole('region', { name: 'CSVの選択' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /に確定$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^科目: / })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('CSVを選択'), { target: { files: [csvFile(`${HEADER}2026/10/07,カフェ,-500,96700\n`, 'next.csv')] } })
    expect(await screen.findByText(/next\.csv を読み込み済み/)).toBeInTheDocument()
  })

  it('科目に名義があるときは、名義を表示のみで出し(選択欄は出さない)、その人の明細として確定する(計画Issue #193)', async () => {
    const hanako = new SqlJsHouseholdMemberRepository(db).create({ name: '花子' })
    const card = accounts.create({ category: 'asset', name: '花子の口座', isReconcilable: true, householdMemberId: hanako.id })
    makeMapping({ accountIds: [card.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    expect(screen.getByText('花子(科目の名義)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })).not.toBeInTheDocument()
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「花子の口座」に確定$/ }))

    await screen.findByText(/確定しました/)
    expect(userEntries()[0]).toMatchObject({ householdMemberId: hanako.id })
  })

  it('科目に名義が無いときは「誰の明細か」を選ばせ、未選択のままでは確定できず、選んだ人が起票者と全行に入る(計画Issue #193)', async () => {
    const hanako = new SqlJsHouseholdMemberRepository(db).create({ name: '花子' })
    makeMapping()
    renderScreen()
    fireEvent.change(await screen.findByLabelText('CSVを選択'), {
      target: { files: [csvFile(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)] },
    })
    await screen.findByText(/statement\.csv を読み込み済み/)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    const confirm = screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ })
    expectMember('誰の明細か(必須)', '誰の明細か選んでください')
    expect(confirm).toBeDisabled()
    expect(screen.getByText('誰の明細かを選ぶと確定できます')).toBeInTheDocument()

    chooseMember('誰の明細か(必須)', '花子')
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await screen.findByText(/確定しました/)
    const created = userEntries()[0]
    expect(created.householdMemberId).toBe(hanako.id)
    expect(created.lines.map((l) => l.householdMemberId)).toEqual([hanako.id, hanako.id])
  })

  it('名義の無い科目で世帯メンバーが0件のときは、選択肢が空で、確定できず理由を表示する(計画Issue #193)', async () => {
    makeMapping()
    renderScreen({ findAll: () => [] })
    fireEvent.change(await screen.findByLabelText('CSVを選択'), {
      target: { files: [csvFile(`${HEADER}2026/10/05,スーパー,-3000,97000
`)] },
    })
    await screen.findByText(/statement\.csv を読み込み済み/)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    expect(listMemberOptions('誰の明細か(必須)')).toEqual(['誰の明細か選んでください'])
    expect(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ })).toBeDisabled()
    expect(screen.getByText('誰の明細かを選ぶと確定できます')).toBeInTheDocument()
    expect(userEntries()).toHaveLength(0)
  })

  it('取込先の科目を変えると、選んだ「誰の明細か」は選び直しになる(計画Issue #193)', async () => {
    const other = accounts.create({ category: 'asset', name: '別の預金', isReconcilable: true })
    makeMapping({ accountIds: [bank.id, other.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)
    await chooseTargetAccount(bank.name)
    await screen.findByText(/statement\.csv を読み込み済み/)
    chooseMember('誰の明細か(必須)', '自分')
    expectMember('誰の明細か(必須)', '自分')

    await chooseTargetAccount(other.name)

    await screen.findByText(/statement\.csv を読み込み済み/)
    expectMember('誰の明細か(必須)', '誰の明細か選んでください')
  })

  it('CSVを選ぶ前は画面の中央に「CSVを選択」ボタンと案内を出し、CSVを選ぶと上部のボタンに移る(計画Issue #193)', async () => {
    makeMapping()
    renderScreen()

    const start = await screen.findByRole('region', { name: 'CSVの選択' })
    expect(within(start).getByRole('button', { name: 'CSVを選択' })).toBeInTheDocument()
    expect(within(start).getByText(/明細CSVを選ぶと、同じ画面に一覧が表示されます/)).toBeInTheDocument()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)

    expect(screen.queryByRole('region', { name: 'CSVの選択' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'CSVを選択' })).toHaveLength(1)
  })

  describe('編集中に新しいCSVを選ぼうとしたときの警告(計画Issue #193)', () => {
    let openPicker: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      openPicker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    })
    afterEach(() => openPicker.mockRestore())

    const clickChoose = () => fireEvent.click(screen.getAllByRole('button', { name: 'CSVを選択' })[0])

    it('編集していなければ、確認なしでファイル選択を開く', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)

      clickChoose()

      expect(openPicker).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog', { name: '未保存の変更があります' })).not.toBeInTheDocument()
    })

    it('編集中は確認が出て、「キャンセル」ではファイル選択を開かず、「破棄して移動」で開く', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      clickChoose()
      expect(screen.getByRole('dialog', { name: '未保存の変更があります' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(openPicker).not.toHaveBeenCalled()

      clickChoose()
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(openPicker).toHaveBeenCalledTimes(1)
      expect(userEntries()).toHaveLength(0)
    })

    it('「保存して移動」では、行を確定してからファイル選択を開く', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      clickChoose()
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

      await waitFor(() => expect(openPicker).toHaveBeenCalledTimes(1))
      expect(userEntries()).toHaveLength(1)
    })
  })

  describe('編集中に他の画面へ移ろうとしたときの警告(計画Issue #193)', () => {
    const leave = () => fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))

    it('編集していなければ、確認なしで移動する', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)

      leave()

      expect(screen.getByTestId('where')).toHaveTextContent('/other')
      expect(screen.queryByRole('dialog', { name: '未保存の変更があります' })).not.toBeInTheDocument()
    })

    it('行を編集していると確認が出て、「キャンセル」で画面に残り、「破棄して移動」で何も確定せず移動する', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      leave()
      expect(screen.getByRole('dialog', { name: '未保存の変更があります' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(screen.getByTestId('where')).toHaveTextContent('/master/here')

      leave()
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(screen.getByTestId('where')).toHaveTextContent('/other')
      expect(userEntries()).toHaveLength(0)
    })

    it('「保存して移動」では、行を確定してから移動する', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      leave()
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
      expect(userEntries()).toHaveLength(1)
    })

    it('確定できない行(相手科目が未選択)が残るときは、「保存して移動」で、入力済みの行を確定し、残りの行を一時保存して移動する(計画Issue #231 フェーズ3)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,カフェ,-500,96500
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      leave()
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
      expect(userEntries()).toHaveLength(1)
      expect(new SqlJsStatementImportDraftRepository(db).findSummaries()).toHaveLength(1)
    })

    it('「マッピングを編集」も、編集中は確認を通してから移る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      fireEvent.click(screen.getByRole('button', { name: 'マッピングを編集' }))
      expect(onEditMappings).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))

      expect(onEditMappings).toHaveBeenCalledTimes(1)
    })

    it('警告の設定が「出さない」のときは、編集中でも確認なしで移動する', async () => {
      localStorage.setItem('localbudget:unsaved-warning', 'off')
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      leave()

      expect(screen.getByTestId('where')).toHaveTextContent('/other')
    })
  })

  describe('確定時の未入力の行とエラー表示(計画Issue #263)', () => {
    it('相手科目が未入力の行は、エラーにせず確定の対象から外し、行は表に残す', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,カフェ,-500,96500\n`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      fireEvent.click(await screen.findByRole('button', { name: /^\d+ \/ 2 件を「普通預金」に確定$/ }))

      await screen.findByText(/1件を確定しました/)
      expect(userEntries()).toHaveLength(1)
      expect(screen.queryByText(/相手科目が未選択です/)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(rowOf(/カフェ/).getByLabelText('カフェのコメント')).toBeInTheDocument()
    })

    it('確定後に、確定した件数と、確定していない未入力の件数を、黄色の案内1行で出す', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,カフェ,-500,96500\n2026/10/07,本屋,-900,95600\n`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      fireEvent.click(await screen.findByRole('button', { name: /^\d+ \/ 3 件を「普通預金」に確定$/ }))

      const notice = await screen.findByText(/1件を確定しました。未入力の2件は確定していません/)
      expect(notice).toHaveClass('import-remaining')
    })

    it('確定できなかった行があるときは、「新規」タブの札に赤の「要対応」が出て、別のタブにいても案内のリンクで、その行へ移れる', async () => {
      makeMapping()
      const manual = (entryDate: string, amount: number, memo: string) =>
        entries.create({
          householdMemberId: memberId,
          entryDate,
          memo,
          sourceType: 'manual',
          lines: [
            { householdMemberId: memberId, accountId: food.id, side: 'debit', amount },
            { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount },
          ],
        })
      renderScreen()
      // スーパーを先に確定しておき、同じ行を取り込み直して「重複」タブに出す。コーヒーは似た取引が2件ある
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
      await screen.findByText(/確定しました/)
      manual('2026-10-04', 480, '近い方')
      manual('2026-10-03', 490, '遠い方')
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/05,コーヒー,-480,96520\n`)
      pick(rowOf(/コーヒー/), '相手科目', '食費')
      fireEvent.click(await screen.findByRole('radio', { name: '同じ取引なので、登録済みを削除して置き換える' }))
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

      await screen.findByText(/確定できなかった行が1件あります/)
      expect(within(screen.getByRole('tab', { name: /^新規/ })).getByText('要対応 1')).toHaveClass('import-tab__state--error')

      openTab('重複')
      expect(screen.queryByText(/削除する登録済みの仕訳が未選択です/)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '新規のタブへ' }))

      expect(screen.getByRole('tab', { name: /^新規/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText(/削除する登録済みの仕訳が未選択です/)).toBeInTheDocument()
    })

    it('入力済みの行が1件も無いときは、確定せず、確定できる行が無いことと未入力の件数を案内する', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

      fireEvent.click(await screen.findByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

      expect(await screen.findByText(/確定できる行がありません。未入力の1件は確定していません/)).toBeInTheDocument()
      expect(userEntries()).toHaveLength(0)
    })
  })

  describe('似た取引がある行(日付3日以内・金額3%以内の登録済みの取引)', () => {
    /** 食費と普通預金の手入力の仕訳(摘要=memo)を作る */
    function manualEntry(entryDate: string, amount: number, memo: string) {
      return entries.create({
        householdMemberId: memberId,
        entryDate,
        memo,
        sourceType: 'manual',
        lines: [
          { householdMemberId: memberId, accountId: food.id, side: 'debit', amount },
          { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount },
        ],
      })
    }
    const radio = (name: string) => screen.findByRole('radio', { name })

    it('警告に、似た取引の出どころ・日付・摘要・金額を出し、既定は「別の取引なので追加する」で、確定すると登録済みを残して追加する', async () => {
      makeMapping()
      manualEntry('2026-10-04', 3000, 'スーパー(手入力)')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      const warning = within(await screen.findByRole('group', { name: 'スーパーの似た取引の確認' }))
      expect(warning.getByText('似た取引が登録済みです。二重ではありませんか?')).toBeInTheDocument()
      expect(warning.getByText('手入力')).toBeInTheDocument()
      expect(warning.getByText('2026/10/04')).toBeInTheDocument()
      expect(warning.getByText('スーパー(手入力)')).toBeInTheDocument()
      expect(warning.getByText('-¥3,000')).toBeInTheDocument()
      expect(await radio('別の取引なので追加する')).toBeChecked()

      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

      await screen.findByText(/確定しました/)
      expect(userEntries().map((e) => e.sourceType).sort()).toEqual(['external_import', 'manual'])
    })

    it('「同じ取引なので、登録済みを削除して置き換える」を選ぶと、登録済みの仕訳を削除してこの取引で置き換える', async () => {
      makeMapping()
      const manual = manualEntry('2026-10-05', 3000, 'スーパー')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      fireEvent.click(await radio('同じ取引なので、登録済みを削除して置き換える'))

      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

      await screen.findByText(/確定しました/)
      // 削除した仕訳のIDは新しい仕訳に再利用されうるので、手入力の仕訳が残っていないことを起源で確認する
      expect(manual.sourceType).toBe('manual')
      expect(userEntries().map((e) => e.sourceType)).toEqual(['external_import'])
    })

    it('「この取引を保存しない」を選ぶと行がグレーになって編集できず、確定の対象から外れる。選び直すと編集できる', async () => {
      makeMapping()
      manualEntry('2026-10-05', 3000, 'スーパー')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
`)
      const comment = () => screen.getByLabelText('スーパーのコメント')
      expect(comment()).toBeEnabled()

      fireEvent.click(await radio('この取引を保存しない'))

      expect(comment()).toBeDisabled()
      expect(rowOf(/スーパー/).getByText('保存しない')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ })).toBeInTheDocument()

      fireEvent.click(await radio('別の取引なので追加する'))

      expect(comment()).toBeEnabled()
      expect(screen.getByRole('button', { name: /^\d+ \/ 2 件を「普通預金」に確定$/ })).toBeInTheDocument()
    })

    it('「新規」タブの一覧では、似た取引がある行を先頭に寄せて、同じ一覧の中に並べ、タブの札に似た取引の件数を出す(計画Issue #263)', async () => {
      makeMapping()
      manualEntry('2026-10-06', 800, 'ランチ')
      renderScreen()
      // CSVでは似た取引がない行(スーパー)が先、似た取引がある行(ランチ)が後
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
`)

      const lunch = (await screen.findAllByRole('row', { name: /ランチ/ }))[0]
      const supermarket = screen.getAllByRole('row', { name: /スーパー/ })[0]
      expect(lunch.compareDocumentPosition(supermarket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const tab = screen.getByRole('tab', { name: /^新規/ })
      expect(within(tab).getByText('似た取引 1')).toBeInTheDocument()
      expect(within(tab).getByText('未入力 2')).toBeInTheDocument()
      expect(screen.getByText(/似た取引あり 1 件/)).toBeInTheDocument()
    })

    it('似た取引が複数あるときは、近い1件だけを出して「ほか N 件を見る」で開き、置き換えるなら削除する1件を選ぶまで確定できない', async () => {
      makeMapping()
      const keep = manualEntry('2026-10-04', 3000, '近い方')
      const other = manualEntry('2026-10-03', 3060, '遠い方')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      const warning = within(await screen.findByRole('group', { name: 'スーパーの似た取引の確認' }))
      expect(warning.getByText('近い方')).toBeInTheDocument()
      expect(warning.queryByText('遠い方')).not.toBeInTheDocument()

      fireEvent.click(warning.getByRole('button', { name: 'ほか 1 件を見る' }))

      expect(warning.getByText('遠い方')).toBeInTheDocument()
      fireEvent.click(await radio('同じ取引なので、登録済みを削除して置き換える'))
      expect(rowOf(/スーパー/).getByText('要確認')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
      // エラーは最下部の一覧ではなく、その行の似た取引の確認の中に出る(計画Issue #263)
      const rowError = await screen.findByText(/削除する登録済みの仕訳が未選択です/)
      expect(within(screen.getByRole('group', { name: 'スーパーの似た取引の確認' })).getByText(/削除する登録済みの仕訳が未選択です/)).toBe(rowError)
      expect(rowError.closest('[role="alert"]')).not.toBeNull()
      expect(rowOf(/スーパー/).getByText('要確認').closest('tr')).toHaveClass('import-row--error')
      expect(userEntries()).toHaveLength(2)

      fireEvent.change(screen.getByLabelText('削除する登録済みの仕訳'), { target: { value: String(other.id) } })
      // 直すと、その行のエラーは消える
      expect(screen.queryByText(/削除する登録済みの仕訳が未選択です/)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

      await screen.findByText(/確定しました/)
      expect(userEntries().map((e) => e.memo)).toContain('近い方')
      expect(userEntries().map((e) => e.memo)).not.toContain('遠い方')
      expect(keep.sourceType).toBe('manual')
    })

    it('残高照合の見込みは、「置き換える」を選んだ行の登録済みの仕訳を除き、「追加する」のままなら二重に数えてずれを知らせる', async () => {
      makeMapping()
      manualEntry('2026-10-05', 3000, 'スーパー')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,-3000\n`)

      expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()

      fireEvent.click(await radio('同じ取引なので、登録済みを削除して置き換える'))

      expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
    })

    it('候補が複数あるとき、残高照合の見込みから除くのは削除先に選んだ1件だけ(選んでいないほうは帳簿に残る)', async () => {
      makeMapping()
      const keep = manualEntry('2026-10-04', 3000, '近い方')
      const other = manualEntry('2026-10-03', 3060, '遠い方')
      renderScreen()
      // 最初の基準点(10/02の100,000円)は元手になり、差異にならない。2つ目の基準点(10/05)で、帳簿とずれるかを見る。
      // 「遠い方」だけを除くと 100,000 - 3,000(近い方) - 3,000(この取引) = 94,000 で一致する。
      // どちらも除かない(90,940)・両方を除く(97,000)・「近い方」を取り違えて除く(93,940)なら一致しない
      await chooseCsv(`${HEADER}2026/10/02,コンビニ,-100,100000
2026/10/05,スーパー,-3000,94000
`)
      fireEvent.click(await radio('同じ取引なので、登録済みを削除して置き換える'))
      expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('削除する登録済みの仕訳'), { target: { value: String(keep.id) } })
      expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('削除する登録済みの仕訳'), { target: { value: String(other.id) } })
      expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
    })

    it('「この取引を保存しない」を選んだ行は、取り込む行として残高照合の見込みに数えない', async () => {
      makeMapping()
      manualEntry('2026-10-05', 3000, 'スーパー')
      renderScreen()
      // 保存しない行(-3,000)を数えると -6,800 になり、数えなければ登録済み(-3,000)とランチ(-800)で -3,800 に一致する
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,-3000\n2026/10/06,ランチ,-800,-3800\n`)
      expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()

      fireEvent.click(await radio('この取引を保存しない'))

      expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
    })

    it('似た明細が続くCSVでも、1件の登録済みの取引は最も近い1行にだけ警告が出る', async () => {
      makeMapping()
      manualEntry('2026-10-05', 480, 'コーヒー')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/04,コーヒー,-480,100
2026/10/05,コーヒー,-480,100
2026/10/06,コーヒー,-480,100
`)

      await screen.findAllByText('似た取引が登録済みです。二重ではありませんか?')

      expect(screen.getAllByText('似た取引が登録済みです。二重ではありませんか?')).toHaveLength(1)
    })
  })

  it('残高が照合対象の取込先では、基準点(取引後残高)と帳簿が合わない期間を、自動調整が入ることとあわせて表示する(計画Issue #205)', async () => {
    makeMapping()
    renderScreen()

    // 10/05=97000 と 10/20=90000 の間は残高が7000減るが、取り込む行は1000だけ → 10/06〜10/20 に6000のずれ
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/20,コンビニ,-1000,90000\n`)

    expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()
    expect(screen.getByText(/2026-10-06〜2026-10-20/)).toBeInTheDocument()
    expect(screen.getByText(/確定すると.*自動で調整/)).toBeInTheDocument()
  })

  it('取り込んだ明細の残高と帳簿が合っていれば、一致していることを表示する', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/20,コンビニ,-1000,96000\n`)

    expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
  })

  it('取引先を選んだ行でも、摘要は自動ではキーワードに登録されない(自動学習の廃止。計画Issue #259)', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'スーパーA' })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
    pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
    pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')

    fireEvent.click(confirmButton(1))

    expect(await screen.findByText(/確定しました/)).toBeInTheDocument()
    expect(screen.queryByText(/キーワードを.*件登録/)).not.toBeInTheDocument()
    expect(keywordRules.findByCounterparty(cp.id)).toEqual([])
  })

  describe('キーワードのアイコンとポップアップ(計画Issue #259)', () => {
    /** 取引先と相手科目を手で選んだ行を作る(キーワードは、指定しなければ1件も無い) */
    async function setupPickedRow(
      description = 'スーパー 新宿店',
      extra: (cpId: number) => void = () => undefined,
      keywordRepository: SqlJsKeywordRuleRepository = keywordRules,
    ) {
      makeMapping()
      const cp = counterparties.create({ name: 'スーパーA' })
      extra(cp.id)
      renderScreen(undefined, undefined, keywordRepository)
      await chooseCsv(`${HEADER}2026/10/05,${description},-3000,97000\n`)
      pick(rowOf(new RegExp(description)), '相手科目', '食費')
      pick(rowOf(new RegExp(description)), '取引先', 'スーパーA')
      return cp
    }
    const patternsOf = (cpId: number) => keywordRules.findByCounterparty(cpId).map((p) => p.pattern)
    const iconOf = (desc: string, kind: '取引先' | '相手科目') => rowOf(new RegExp(desc)).getByRole('button', { name: `${desc}の${kind}のキーワード` })
    /** 「ニチケイ」を含む行が複数ある明細で、先頭の行に取引先・相手科目を手で選び、そのポップアップを開いて「ニチケイ」を登録する */
    async function setupApplyCase() {
      makeMapping()
      const cp = counterparties.create({ name: 'スーパーA' })
      const other = counterparties.create({ name: 'スーパーB' })
      renderScreen()
      await chooseCsv(
        `${HEADER}2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n2026/10/07,別の店 1月,-500,95500\n2026/10/08,ニチケイ 4月,-1000,94500\n`,
      )
      pick(rowOf(/ニチケイ 3月/), '相手科目', '食費')
      pick(rowOf(/ニチケイ 3月/), '取引先', 'スーパーA')
      // 4行目は利用者が別の取引先を手で選んでいる
      pick(rowOf(/ニチケイ 4月/), '相手科目', '食費')
      pick(rowOf(/ニチケイ 4月/), '取引先', 'スーパーB')
      await openCounterpartySettings('ニチケイ 3月')
      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ニチケイ' } })
      fireEvent.blur(settings().getByLabelText('キーワード1'))
      await waitFor(() => expect(patternsOf(cp.id)).toEqual(['ニチケイ']))
      return { cp, other }
    }

    describe('入口のアイコン', () => {
      it('相手科目と取引先の選択欄それぞれの右にアイコンが出て、未選択のアイコンは押せない', async () => {
        makeMapping()
        counterparties.create({ name: 'スーパーA' })
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)

        expect(iconOf('スーパー 新宿店', '相手科目')).toBeDisabled()
        expect(iconOf('スーパー 新宿店', '取引先')).toBeDisabled()

        pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
        expect(iconOf('スーパー 新宿店', '相手科目')).toBeEnabled()
        expect(iconOf('スーパー 新宿店', '取引先')).toBeDisabled()

        pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')
        expect(iconOf('スーパー 新宿店', '取引先')).toBeEnabled()
      })

      it('重複の行(取り込み済みのため対象外)には、アイコンを出さない', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
        pick(rowOf(/スーパー/), '相手科目', '食費')
        fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
        await screen.findByText(/確定しました/)

        await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
        openTab('重複')

        expect(await rowOf(/スーパー/).findByText('取り込み済みのため対象外です')).toBeInTheDocument()
        expect(rowOf(/スーパー/).queryByRole('button', { name: /のキーワード$/ })).not.toBeInTheDocument()
      })

      it('この行に一致したキーワードがある側のアイコンは強調され、ツールチップに一致したキーワードが出る', async () => {
        makeMapping()
        const cp = counterparties.create({ name: 'スーパーA' })
        keywordRules.create({ pattern: 'ローソン', counterpartyId: cp.id })
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,ローソン 渋谷,-500,97000\n2026/10/06,別の店,-500,96500\n`)

        await waitFor(() => expect(iconOf('ローソン 渋谷', '取引先')).toHaveClass('import-icon-btn--matched'))
        expect(iconOf('ローソン 渋谷', '取引先')).toHaveAttribute('title', expect.stringContaining('ローソン'))
        // 一致したキーワードが無い行・科目側(このキーワードは科目を持たない)は強調しない
        expect(iconOf('ローソン 渋谷', '相手科目')).not.toHaveClass('import-icon-btn--matched')
        pick(rowOf(/別の店/), '取引先', 'スーパーA')
        expect(iconOf('別の店', '取引先')).not.toHaveClass('import-icon-btn--matched')
      })

      it('自動で一致した行でもポップアップを開いて編集でき、一致したキーワードの行には「この行に一致」が出る', async () => {
        makeMapping()
        const cp = counterparties.create({ name: 'スーパーA' })
        keywordRules.create({ pattern: 'ローソン', counterpartyId: cp.id })
        keywordRules.create({ pattern: 'ファミマ', counterpartyId: cp.id })
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,ローソン 渋谷,-500,97000\n`)
        await waitFor(() => expect(iconOf('ローソン 渋谷', '取引先')).toBeEnabled())

        await openCounterpartySettings('ローソン 渋谷')

        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ローソン'))
        expect(settings().getAllByText('この行に一致')).toHaveLength(1)
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ローソン渋谷' } })
        fireEvent.blur(settings().getByLabelText('キーワード1'))
        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['ローソン渋谷', 'ファミマ']))
      })
    })

    describe('ポップアップの見出し・幅・削除・保存ボタン', () => {
      it('見出しは「取引先「X」のキーワード」で、幅は約720px、保存ボタンは無い', async () => {
        await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')

        const dialog = screen.getByRole('dialog', { name: '取引先「スーパーA」のキーワード' })
        expect(within(dialog).getByText('取引先「スーパーA」のキーワード')).toBeInTheDocument()
        expect(dialog.style.width).toBe('720px')
        expect(within(dialog).queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
        // 全体の「ほかの行にも適用」は廃止した
        expect(within(dialog).queryByRole('button', { name: 'ほかの行にも適用' })).not.toBeInTheDocument()
      })

      it('削除はaria-label付きのゴミ箱アイコンで、押した時点でDBから消える', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        const trash = settings().getByRole('button', { name: 'キーワード1を削除' })
        expect(trash.querySelector('svg')).not.toBeNull()
        fireEvent.click(trash)

        await waitFor(() => expect(patternsOf(cp.id)).toEqual([]))
        expect(settings().queryByDisplayValue('マルエツ')).not.toBeInTheDocument()
      })

      it('キーワードごとに科目を選べ(選択肢は費用・収益の科目だけで、科目グループごとにまとまる)、選んだ時点で保存される', async () => {
        const group = new SqlJsAccountGroupRepository(db).create({ name: '生活費', category: 'expense' })
        accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null, accountGroupId: group.id })
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))
        expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBeNull()

        fireEvent.click(settings().getByRole('button', { name: /^キーワード1の科目/ }))
        const tree = within(screen.getByRole('dialog', { name: 'キーワード1の科目' }))
        expect(tree.queryByRole('button', { name: '普通預金' })).not.toBeInTheDocument()
        fireEvent.click(tree.getByText('生活費'))
        fireEvent.click(tree.getByRole('button', { name: '日用品費' }))

        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).not.toBeNull())
        expect(settings().getByRole('button', { name: /^キーワード1の科目: 日用品費/ })).toBeInTheDocument()
      })
    })

    describe('保存(入力を終えたときと、閉じる操作)', () => {
      it('登録済みのキーワードの編集は、入力の途中では保存されず、入力を終えたとき(フォーカスを外す)に保存される', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'マルエツ新宿' } })
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])

        fireEvent.blur(settings().getByLabelText('キーワード1'))

        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['マルエツ新宿']))
      })

      it('Enterでも入力を終えたことになり、フォーカスを外すのと重ねても二重には保存されない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'スーパー' } })

        fireEvent.keyDown(settings().getByLabelText('キーワード1'), { key: 'Enter' })
        fireEvent.blur(settings().getByLabelText('キーワード1'))

        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['スーパー']))
        expect(screen.queryByText('保存できませんでした。もう一度お試しください。')).not.toBeInTheDocument()
      })

      it.each([
        ['閉じるボタン', () => fireEvent.click(settings().getByRole('button', { name: '閉じる' }))],
        ['Esc', () => fireEvent.keyDown(screen.getByRole('dialog', { name: /のキーワード$/ }), { key: 'Escape' })],
        ['外側のクリック', () => fireEvent.pointerDown(document.body)],
      ])('入力中の内容は、フォーカスを外す前に%sで閉じても保存される(破棄されない)', async (_name, close) => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'マルエツ新宿' } })
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'ライフ' } })

        close()

        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['マルエツ新宿', 'ライフ']))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /のキーワード$/ })).not.toBeInTheDocument())
      })

      it('入力を終えてから閉じても、同じキーワードを二重に保存しない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'スーパー' } })
        fireEvent.blur(settings().getByLabelText('キーワード1'))
        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['スーパー']))

        fireEvent.click(settings().getByRole('button', { name: '閉じる' }))

        await waitFor(() => expect(screen.queryByRole('dialog', { name: /のキーワード$/ })).not.toBeInTheDocument())
        expect(patternsOf(cp.id)).toEqual(['スーパー'])
      })

      it('保存できない入力(登録済みのキーワードを空にした)があるときは、閉じずにその旨を出し、保存しない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: '  ' } })

        fireEvent.click(settings().getByRole('button', { name: '閉じる' }))

        expect(await settings().findByText('キーワードを入力してください。消す場合は削除を押してください')).toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: /のキーワード$/ })).toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])
      })

      it('追加して何も入力しなかった空欄は、入力を終えると何も保存せずに取り除かれる', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: '' } })

        fireEvent.blur(settings().getByLabelText('キーワード1'))

        expect(settings().queryByLabelText('キーワード1')).not.toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual([])
      })

      it('ほかのキーワードと、正規化すると同じになる文字列は、その旨を出して保存しない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'スーパー新宿店', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('スーパー新宿店'))
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'ｽｰﾊﾟｰ新宿店' } })
        fireEvent.blur(settings().getByLabelText('キーワード2'))

        expect(settings().getByText('同じキーワードがあります')).toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual(['スーパー新宿店'])
      })

      it('保存できなかったら、ポップアップ内にエラーを出し、入力した内容は残す', async () => {
        const failing = (method: 'update' | 'create' | 'delete') =>
          Object.assign(Object.create(keywordRules), {
            [method]: () => {
              throw new Error('保存の失敗')
            },
          }) as typeof keywordRules
        const SAVE_ERROR = '保存できませんでした。もう一度お試しください。'
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }), failing('update'))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'マルエツ新宿' } })
        fireEvent.click(settings().getByRole('button', { name: '閉じる' }))

        expect(await settings().findByText(SAVE_ERROR)).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ新宿')
        expect(screen.getByRole('dialog', { name: /のキーワード$/ })).toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])
      })

      it('登録済みのキーワードの削除を保存できなかったら、ポップアップ内にエラーを出し、一覧からは消さない', async () => {
        const failingDelete = Object.assign(Object.create(keywordRules), {
          delete: () => {
            throw new Error('保存の失敗')
          },
        }) as typeof keywordRules
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }), failingDelete)
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.click(settings().getByRole('button', { name: 'キーワード1を削除' }))

        expect(await settings().findByText('保存できませんでした。もう一度お試しください。')).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ')
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])
      })

      it('キーワードの科目を保存できなかったら、ポップアップ内にエラーを出し、科目は変わらない', async () => {
        const failingUpdate = Object.assign(Object.create(keywordRules), {
          update: () => {
            throw new Error('保存の失敗')
          },
        }) as typeof keywordRules
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }), failingUpdate)
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        pick(settings(), 'キーワード1の科目', '食費')

        expect(await settings().findByText('保存できませんでした。もう一度お試しください。')).toBeInTheDocument()
        expect(settings().getByRole('button', { name: /^キーワード1の科目: 指定なし/ })).toBeInTheDocument()
        expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBeNull()
      })
    })

    describe('「キーワードを追加」と自動学習の廃止', () => {
      it('取引先・科目を手で選んでも、摘要は「新規」のキーワードとして出ず、開いた時点では何も登録されていない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')

        expect(settings().queryByLabelText('キーワード1')).not.toBeInTheDocument()
        expect(settings().queryByText('新規')).not.toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual([])
      })

      it('「キーワードを追加」を押すと、その行の摘要が初期値として入り、入力を終えたときに(正規化して)登録される', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')

        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        expect(settings().getByLabelText('キーワード1')).toHaveValue('スーパー 新宿店')
        expect(settings().getByText('新規')).toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual([])
        fireEvent.blur(settings().getByLabelText('キーワード1'))
        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['スーパー新宿店']))
        expect(settings().getByText('登録済み')).toBeInTheDocument()
      })

      it('摘要の半角カナ・全角英数は標準化して初期値に入り、標準化した文字列で登録される', async () => {
        makeMapping()
        const cp = counterparties.create({ name: 'ファミマ' })
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,ﾌｧﾐﾘｰﾏｰﾄ Ｓｕｉｃａ,-300,97000\n`)
        pick(rowOf(/ファミリーマート/), '相手科目', '食費')
        pick(rowOf(/ファミリーマート/), '取引先', 'ファミマ')
        await openCounterpartySettings('ファミリーマート Suica')

        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        expect(settings().getByLabelText('キーワード1')).toHaveValue('ファミリーマート Suica')
        fireEvent.click(settings().getByRole('button', { name: '閉じる' }))
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id).map((r) => r.pattern)).toEqual(['フアミリーマートSUICA']))
      })

      it('新規のキーワードが現在の摘要にマッチしない文字列でも、注意を出したうえで保存できる(計画Issue #236)', async () => {
        const cp = await setupPickedRow('スーパー 新宿店')
        await openCounterpartySettings('スーパー 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ローソン' } })
        expect(settings().getByText('現在の明細の摘要とはマッチしないキーワードです。')).toBeInTheDocument()
        fireEvent.blur(settings().getByLabelText('キーワード1'))

        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['ローソン']))
      })

      it('新規のキーワードの科目は、取引先の登録済みキーワードで最も多い科目が初期値になる(計画Issue #236)', async () => {
        await setupPickedRow('スーパー 新宿店', (id) => {
          keywordRules.create({ pattern: 'マルエツ', counterpartyId: id, accountId: food.id })
          keywordRules.create({ pattern: 'ライフ', counterpartyId: id, accountId: food.id })
        })
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        expect(settings().getByRole('button', { name: /^キーワード3の科目: 食費/ })).toBeInTheDocument()
      })
    })

    describe('キーワードごとの「N行を上書き」(計画Issue #291)', () => {
      const OVERWRITE_DIALOG = 'キーワードに一致する行を上書きしますか?'
      const dialog = () => within(screen.getByRole('dialog', { name: OVERWRITE_DIALOG }))

      it('N は、そのキーワードを含むほかの行の数で、取引先を手で選んだ行も数える(この行自身・含まない行は数えない)', async () => {
        await setupApplyCase()

        // 2月の行(未入力)と4月の行(別の取引先を手で選んだ)の2行。3月の行(この行)・別の店の行は数えない
        expect(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' })).toBeEnabled()
        // 「N行に適用」は未入力の2月の行だけの1行のまま
        expect(settings().getByRole('button', { name: '1行に適用' })).toBeEnabled()
      })

      it('ツールチップに、入力済みの行も含めてすべて更新するボタンだと出る', async () => {
        await setupApplyCase()

        expect(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' })).toHaveAttribute('title', 'このキーワードを含むすべての行を更新')
      })

      it('押すと確認ダイアログが出て、押しただけでは行を書き換えない。入力済みの行数も伝える', async () => {
        await setupApplyCase()

        fireEvent.click(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' }))

        expect(dialog().getByText(/取引先「スーパーA」/)).toBeInTheDocument()
        expect(dialog().getByText(/入力済みの行\(1行\)も書き換わります/)).toBeInTheDocument()
        expect(rowOf(/ニチケイ 4月/).getByRole('button', { name: /^取引先: スーパーB/ })).toBeInTheDocument()
        expect(rowOf(/ニチケイ 2月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
      })

      it('確認で「上書きする」を押すと、手で選んだ行も取引先が書き換わり、結果が出る。DBには書かない', async () => {
        const { cp, other } = await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' }))

        fireEvent.click(dialog().getByRole('button', { name: '2行を上書きする' }))

        expect(screen.queryByRole('dialog', { name: OVERWRITE_DIALOG })).not.toBeInTheDocument()
        expect(settings().getByText('2行を上書きしました')).toBeInTheDocument()
        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
        expect(rowOf(/ニチケイ 4月/).getByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
        expect(rowOf(/別の店 1月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual(['ニチケイ'])
        expect(patternsOf(other.id)).toEqual([])
        expect(userEntries()).toHaveLength(0)
        // 上書きしたあとは、どの行も同じ取引先なので、もう数えない
        expect(settings().getByRole('button', { name: '上書きできるほかの行はありません' })).toBeDisabled()
      })

      it('確認でキャンセルすると、何も書き換えない', async () => {
        await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' }))

        fireEvent.click(dialog().getByRole('button', { name: 'キャンセル' }))

        expect(screen.queryByRole('dialog', { name: OVERWRITE_DIALOG })).not.toBeInTheDocument()
        expect(rowOf(/ニチケイ 4月/).getByRole('button', { name: /^取引先: スーパーB/ })).toBeInTheDocument()
        expect(rowOf(/ニチケイ 2月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
      })

      it('確認ダイアログを操作しても、キーワードのポップアップは閉じない', async () => {
        await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: '入力済みも含めて2行を上書き' }))

        fireEvent.pointerDown(screen.getByRole('dialog', { name: OVERWRITE_DIALOG }))

        expect(screen.getByRole('dialog', { name: /^取引先「.*」のキーワード$/ })).toBeInTheDocument()
      })

      it('該当する行が無いキーワードは、ボタンを無効にして理由を出す', async () => {
        await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'スーパー', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('スーパー'))

        const button = settings().getByRole('button', { name: '上書きできるほかの行はありません' })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('title', 'このキーワードを含む行はありません。')
      })
    })

    describe('キーワードごとの「N行に適用」', () => {
      it('N は、そのキーワードを含み取引先が未入力のほかの行の数で、この行自身・手で選んだ行・含まない行は数えない', async () => {
        await setupApplyCase()

        // 3月の行(この行)・4月の行(別の取引先を手で選んだ)・別の店の行は数えず、2月の行だけ
        expect(settings().getByRole('button', { name: '1行に適用' })).toBeEnabled()
      })

      it('押すと、N行に取引先が入って結果が出る。画面上だけでDBには書かず、手で選んだ行は上書きしない', async () => {
        const { cp, other } = await setupApplyCase()

        fireEvent.click(settings().getByRole('button', { name: '1行に適用' }))

        expect(settings().getByText('1行に適用しました')).toBeInTheDocument()
        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
        expect(rowOf(/別の店 1月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
        expect(rowOf(/ニチケイ 4月/).getByRole('button', { name: /^取引先: スーパーB/ })).toBeInTheDocument()
        // DBに書かれたのは、利用者が明示的に登録した「ニチケイ」だけ
        expect(patternsOf(cp.id)).toEqual(['ニチケイ'])
        expect(patternsOf(other.id)).toEqual([])
        expect(keywordRules.findAll()).toHaveLength(1)
        expect(userEntries()).toHaveLength(0)
        // 適用したあとは、その行は入力済みなので、もう数えない
        expect(settings().getByRole('button', { name: 'ほかに該当なし' })).toBeDisabled()
      })

      it('ツールチップに、何を更新するボタンかが出る(未入力の行だけ。件数は表示とaria-labelにある)', async () => {
        await setupApplyCase()

        expect(settings().getByRole('button', { name: '1行に適用' })).toHaveAttribute('title', 'このキーワードを含む未入力の行を更新')
      })

      it('該当する行が無いキーワードは、ボタンを無効にして「ほかに該当なし」と出し、ホバーでは「未入力の行はありません」と伝える', async () => {
        await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'スーパー', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('スーパー'))

        const button = settings().getByRole('button', { name: 'ほかに該当なし' })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('title', 'このキーワードを含む未入力の行はありません。')
      })

      it('含む行はあるが、すべて入力済みで適用できないときも、ホバーは「未入力の行はありません」(上書きは押せる)', async () => {
        await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: '1行に適用' }))

        // 4月の行は手で選んだので、適用はもう0行。上書きの対象としては残る
        expect(settings().getByRole('button', { name: 'ほかに該当なし' })).toHaveAttribute('title', 'このキーワードを含む未入力の行はありません。')
      })

      it('押したキーワードだけで適用し、ほかのキーワードにだけ一致する行には入れない', async () => {
        await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: '別の店' } })
        fireEvent.blur(settings().getByLabelText('キーワード2'))
        await waitFor(() => expect(settings().getAllByRole('button', { name: '1行に適用' })).toHaveLength(2))

        // 1つ目(ニチケイ)のボタンを押す
        fireEvent.click(settings().getAllByRole('button', { name: '1行に適用' })[0])

        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
        expect(rowOf(/別の店 1月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
        // 2つ目(別の店)は、まだ適用できる
        expect(settings().getByRole('button', { name: '1行に適用' })).toBeEnabled()
      })

      it('適用した行は、確定してもキーワードを重ねて登録しない', async () => {
        const { cp } = await setupApplyCase()
        fireEvent.click(settings().getByRole('button', { name: '1行に適用' }))
        fireEvent.click(settings().getByRole('button', { name: '閉じる' }))
        pick(rowOf(/ニチケイ 2月/), '相手科目', '食費')

        fireEvent.click(confirmButton(4))

        await waitFor(() => expect(userEntries().length).toBeGreaterThan(0))
        expect(patternsOf(cp.id)).toEqual(['ニチケイ'])
      })

      it('キーワードに科目があれば、適用した行の相手科目にも入る', async () => {
        const supplies = accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
        const { cp } = await setupApplyCase()
        pick(settings(), 'キーワード1の科目', '日用品費')
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

        fireEvent.click(settings().getByRole('button', { name: /行に適用$/ }))

        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument()
      })
    })

    describe('科目のキーワード(科目アイコン)', () => {
      /** 相手科目に指定した科目を手で選んだ行を作る(取引先は付かない) */
      async function setupAccountRow(
        accountName: string,
        description = 'ATM引出 新宿',
        extra: (accountId: number) => void = () => undefined,
        keywordRepository: SqlJsKeywordRuleRepository = keywordRules,
      ) {
        makeMapping()
        const created =
          accountName === '現金' ? accounts.create({ category: 'asset', name: '現金', isReconcilable: false }) : food
        extra(created.id)
        renderScreen(undefined, undefined, keywordRepository)
        await chooseCsv(`${HEADER}2026/10/05,${description},-10000,90000\n`)
        pick(rowOf(new RegExp(description)), '相手科目', accountName)
        return created
      }
      const accountPopup = () => within(screen.getByRole('dialog', { name: /^科目「.*」のキーワード$/ }))
      const openAccountSettings = async (desc: string) => {
        fireEvent.click(iconOf(desc, '相手科目'))
        await screen.findByRole('dialog', { name: /^科目「.*」のキーワード$/ })
      }
      const accountKeywords = (accountId: number) => keywordRules.findByAccount(accountId).map((r) => r.pattern)

      it('資産・負債の科目の行は、科目アイコンから「科目「現金」のキーワード」を開け、その科目のキーワードが並ぶ(摘要の提案は出ない)', async () => {
        await setupAccountRow('現金', 'ATM引出 新宿', (id) => keywordRules.create({ pattern: 'セブン銀行', accountId: id }))

        await openAccountSettings('ATM引出 新宿')

        expect(screen.getByRole('dialog', { name: '科目「現金」のキーワード' })).toBeInTheDocument()
        await waitFor(() => expect(accountPopup().getByLabelText('キーワード1')).toHaveValue('セブン銀行'))
        expect(accountPopup().queryByLabelText('キーワード2')).not.toBeInTheDocument()
        expect(accountPopup().queryByLabelText('キーワード1の科目')).not.toBeInTheDocument()
      })

      it('取引先なし・PL(費用・収益)の科目の行も、科目アイコンから科目キーワードを登録・編集できる(取引先つきのキーワードは含まない)', async () => {
        const cp = counterparties.create({ name: 'スーパーA' })
        const foodRule = await setupAccountRow('食費', 'スーパー 新宿店', (id) => {
          keywordRules.create({ pattern: 'ライフ', accountId: id })
          keywordRules.create({ pattern: 'マルエツ', counterpartyId: cp.id, accountId: id })
        })

        await openAccountSettings('スーパー 新宿店')

        expect(screen.getByRole('dialog', { name: '科目「食費」のキーワード' })).toBeInTheDocument()
        await waitFor(() => expect(accountPopup().getByLabelText('キーワード1')).toHaveValue('ライフ'))
        expect(accountPopup().queryByDisplayValue('マルエツ')).not.toBeInTheDocument()
        fireEvent.change(accountPopup().getByLabelText('キーワード1'), { target: { value: 'ライフ渋谷' } })
        fireEvent.click(accountPopup().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.click(accountPopup().getByRole('button', { name: '閉じる' }))

        await waitFor(() => expect(accountKeywords(foodRule.id)).toEqual(['ライフ渋谷', 'マルエツ', 'スーパー新宿店']))
        expect(keywordRules.findByAccount(foodRule.id).map((r) => r.counterpartyId)).toEqual([null, cp.id, null])
      })

      it('科目のキーワードの「N行に適用」は、そのキーワードを含み相手科目が未入力の行にだけ科目を入れる(DBには書かない)', async () => {
        makeMapping()
        const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
        renderScreen()
        await chooseCsv(
          `${HEADER}2026/10/05,ATM引出 新宿,-10000,90000\n2026/10/06,ATM引出 渋谷,-5000,85000\n2026/10/07,別の店,-500,84500\n`,
        )
        pick(rowOf(/ATM引出 新宿/), '相手科目', '現金')
        await openAccountSettings('ATM引出 新宿')
        fireEvent.click(accountPopup().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(accountPopup().getByLabelText('キーワード1'), { target: { value: 'ATM引出' } })
        fireEvent.blur(accountPopup().getByLabelText('キーワード1'))
        await waitFor(() => expect(accountKeywords(cash.id)).toEqual(['ATM引出']))

        fireEvent.click(accountPopup().getByRole('button', { name: '1行に適用' }))

        expect(accountPopup().getByText('1行に適用しました')).toBeInTheDocument()
        expect(rowOf(/ATM引出 渋谷/).getByRole('button', { name: /^相手科目: 現金/ })).toBeInTheDocument()
        expect(rowOf(/別の店/).queryByRole('button', { name: /^相手科目: 現金/ })).not.toBeInTheDocument()
        expect(accountKeywords(cash.id)).toEqual(['ATM引出'])
      })

      it('科目のキーワードを保存できなかったら、ポップアップ内にエラーを出し、入力を残す', async () => {
        const failingRules = Object.assign(Object.create(keywordRules), {
          create: () => {
            throw new Error('保存の失敗')
          },
        }) as typeof keywordRules
        await setupAccountRow('現金', 'ATM引出 新宿', () => undefined, failingRules)
        await openAccountSettings('ATM引出 新宿')
        fireEvent.click(accountPopup().getByRole('button', { name: 'キーワードを追加' }))

        fireEvent.change(accountPopup().getByLabelText('キーワード1'), { target: { value: 'ATM' } })
        fireEvent.blur(accountPopup().getByLabelText('キーワード1'))

        expect(await accountPopup().findByText('保存できませんでした。もう一度お試しください。')).toBeInTheDocument()
        expect(accountPopup().getByLabelText('キーワード1')).toHaveValue('ATM')
      })
    })

    it('Escキーでポップアップが閉じる', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.keyDown(screen.getByRole('dialog', { name: /のキーワード$/ }), { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('dialog', { name: /のキーワード$/ })).not.toBeInTheDocument())
    })

    it('ポップアップの外側を押すと閉じるが、中の操作(科目の選択など)では閉じない', async () => {
      await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
      await openCounterpartySettings('スーパー 新宿店')
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

      fireEvent.pointerDown(settings().getByLabelText('キーワード1'))
      expect(screen.getByRole('dialog', { name: /のキーワード$/ })).toBeInTheDocument()

      fireEvent.pointerDown(document.body)
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /のキーワード$/ })).not.toBeInTheDocument())
    })

    it('「閉じる」でポップアップが閉じ、もう一度開くと保存済みのキーワードが見える', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: '新宿' } })
      fireEvent.blur(settings().getByLabelText('キーワード1'))
      await waitFor(() => expect(settings().getByText('登録済み')).toBeInTheDocument())

      fireEvent.click(settings().getByRole('button', { name: '閉じる' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /のキーワード$/ })).not.toBeInTheDocument())
      await openCounterpartySettings('スーパー 新宿店')

      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('新宿'))
    })

    it('開いたまま行の取引先を別の取引先に変えても、アイコンを1回押せば新しい取引先のキーワードが開く', async () => {
      makeMapping()
      counterparties.create({ name: 'スーパーA' })
      counterparties.create({ name: 'スーパーB' })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')
      await openCounterpartySettings('スーパー 新宿店')

      pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーB')
      fireEvent.click(iconOf('スーパー 新宿店', '取引先'))

      expect(await screen.findByRole('dialog', { name: '取引先「スーパーB」のキーワード' })).toBeInTheDocument()
    })

    describe('キーワードの科目を変えたときの、ほかの行への反映(計画Issue #218)', () => {
      /**
       * 「ニチケイ」を含む行(キーワードに一致して取引先・科目が入る)が複数あり、最後の「別の店」の行で取引先を手で選んで
       * 取引先のキーワードのポップアップを開く
       */
      async function setupFollowCase(csvRows: string) {
        makeMapping()
        const supplies = accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
        accounts.create({ category: 'expense', name: '雑費', isReconcilable: null })
        const cp = counterparties.create({ name: 'スーパーA' })
        keywordRules.create({ pattern: 'ニチケイ', counterpartyId: cp.id, accountId: food.id })
        renderScreen()
        await chooseCsv(`${HEADER}${csvRows}2026/10/20,別の店,-100,90000\n`)
        return { supplies, cp }
      }

      it('キーワードの科目を変えた時点で、そのキーワードに一致しその取引先を持つ行の科目が、再適用しなくても新しい科目に変わる', async () => {
        const { supplies, cp } = await setupFollowCase('2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n')
        expect(await rowOf(/ニチケイ 2月/).findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
        pick(rowOf(/別の店/), '相手科目', '食費')
        pick(rowOf(/別の店/), '取引先', 'スーパーA')
        await openCounterpartySettings('別の店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ニチケイ'))

        pick(settings(), 'キーワード1の科目', '日用品費')
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

        await waitFor(() => expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument())
        expect(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument()
        expect(settings().getByText('2行の相手科目をキーワードの科目にしました')).toBeInTheDocument()
      })

      it('科目を手で選び直した行は、キーワードの科目を変えても追従させない', async () => {
        const { supplies, cp } = await setupFollowCase('2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n')
        expect(await rowOf(/ニチケイ 2月/).findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
        pick(rowOf(/ニチケイ 2月/), '相手科目', '雑費')
        pick(rowOf(/別の店/), '相手科目', '食費')
        pick(rowOf(/別の店/), '取引先', 'スーパーA')
        await openCounterpartySettings('別の店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ニチケイ'))

        pick(settings(), 'キーワード1の科目', '日用品費')
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

        await waitFor(() => expect(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument())
        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 雑費/ })).toBeInTheDocument()
        expect(settings().getByText('1行の相手科目をキーワードの科目にしました')).toBeInTheDocument()
      })

      it('キーワードの科目を変えると、直前の「N行に適用」の結果のメッセージは、科目の変更の結果に置き換わる', async () => {
        // 科目は画面を開く前に作っておく(開いたあとに作った科目は一覧に出ない)
        accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
        makeMapping()
        const cp = counterparties.create({ name: 'スーパーA' })
        renderScreen()
        await chooseCsv(`${HEADER}2026/10/05,マルエツ 新宿店,-3000,97000\n2026/10/06,マルエツ 渋谷店,-3000,94000\n`)
        pick(rowOf(/マルエツ 新宿店/), '相手科目', '食費')
        pick(rowOf(/マルエツ 新宿店/), '取引先', 'スーパーA')
        await openCounterpartySettings('マルエツ 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'マルエツ' } })
        fireEvent.blur(settings().getByLabelText('キーワード1'))
        await waitFor(() => expect(patternsOf(cp.id)).toEqual(['マルエツ']))
        fireEvent.click(settings().getByRole('button', { name: '1行に適用' }))
        expect(settings().getByText('1行に適用しました')).toBeInTheDocument()

        // 適用した行は科目を手で選んだ扱いではないが、キーワードの科目が「食費→日用品費」に変わると追従する
        pick(settings(), 'キーワード1の科目', '日用品費')

        await waitFor(() => expect(settings().queryByText('1行に適用しました')).not.toBeInTheDocument())
      })
    })
  })

  describe('取引先の追加ダイアログの改善(計画Issue #218)', () => {
    const openCounterpartyDialog = (desc: RegExp) => {
      fireEvent.click(rowOf(desc).getByRole('button', { name: /^取引先/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先' })).getByRole('button', { name: '+ 取引先を新規追加' }))
    }
    const dialog = () => within(screen.getByRole('dialog', { name: '取引先を追加' }))
    const openCreateAccount = (button: RegExp, listLabel: string) => {
      fireEvent.click(dialog().getByRole('button', { name: button }))
      fireEvent.click(within(screen.getByRole('dialog', { name: listLabel })).getByRole('button', { name: '+ 科目を新規追加' }))
    }

    /** 「ニチケイ」を含む2行のうち、3月の行から取引先「新しい店」(キーワード「ニチケイ」)を追加するところまで進める */
    async function fillCounterpartyDialog() {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n`)
      pick(rowOf(/ニチケイ 3月/), '相手科目', '食費')
      openCounterpartyDialog(/ニチケイ 3月/)
      fireEvent.change(dialog().getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.change(dialog().getByLabelText('キーワード1'), { target: { value: 'ニチケイ' } })
    }

    it('「ほかの行にも適用する」のチェックが、最初から入った状態で出る', async () => {
      await fillCounterpartyDialog()

      expect(dialog().getByRole('checkbox', { name: 'ほかの行にも適用する' })).toBeChecked()
    })

    it('チェックを入れたまま追加すると、キーワードを含み取引先が未設定の行にも、取引先とキーワードの科目が入る(DBにはキーワードは取引先の分だけ)', async () => {
      await fillCounterpartyDialog()

      fireEvent.click(dialog().getByRole('button', { name: '追加' }))

      expect(await rowOf(/ニチケイ 2月/).findByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
      expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
      expect(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
    })

    it('チェックを外して追加すると、ほかの行には反映されず、その行だけに取引先が入る', async () => {
      await fillCounterpartyDialog()

      fireEvent.click(dialog().getByRole('checkbox', { name: 'ほかの行にも適用する' }))
      fireEvent.click(dialog().getByRole('button', { name: '追加' }))

      expect(await rowOf(/ニチケイ 3月/).findByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
      expect(rowOf(/ニチケイ 2月/).queryByRole('button', { name: /^取引先: 新しい店/ })).not.toBeInTheDocument()
    })

    it('科目の選択肢の末尾の「+ 科目を新規追加」から科目を登録でき、登録した科目がそのまま選ばれる', async () => {
      await fillCounterpartyDialog()

      openCreateAccount(/^キーワード1の科目/, 'キーワード1の科目')
      const form = within(screen.getByRole('dialog', { name: '科目を登録' }))
      fireEvent.change(form.getByLabelText('名称'), { target: { value: '新聞図書費' } })
      fireEvent.click(form.getByRole('button', { name: '登録' }))

      expect(await dialog().findByRole('button', { name: /^キーワード1の科目: 新聞図書費/ })).toBeInTheDocument()
      expect(accounts.findAll().some((a) => a.name === '新聞図書費' && a.category === 'expense')).toBe(true)
    })

    it('取引先の追加ダイアログから開いた科目の登録ダイアログは、body直下に出て、入れ子用の重なり順のクラスが付く(計画Issue #287)', async () => {
      await fillCounterpartyDialog()

      openCreateAccount(/^キーワード1の科目/, 'キーワード1の科目')

      const backdrop = screen.getByRole('dialog', { name: '科目を登録' }).parentElement!
      expect(backdrop.parentElement).toBe(document.body)
      expect(backdrop).toHaveClass('import-dialog__backdrop', 'import-dialog__backdrop--nested')
    })

    it('取引先の追加ダイアログから開いた科目の登録ダイアログの背面をクリックしても、下の取引先の追加ダイアログは閉じない(計画Issue #287)', async () => {
      await fillCounterpartyDialog()

      openCreateAccount(/^キーワード1の科目/, 'キーワード1の科目')
      fireEvent.click(screen.getByRole('dialog', { name: '科目を登録' }).parentElement!)

      expect(screen.getByRole('dialog', { name: '取引先を追加' })).toBeInTheDocument()
    })

    it('取引先の追加ダイアログから科目を登録するとき、区分の既定は「費用」である', async () => {
      await fillCounterpartyDialog()

      openCreateAccount(/^キーワード1の科目/, 'キーワード1の科目')

      expect(within(screen.getByRole('dialog', { name: '科目を登録' })).getByLabelText('区分')).toHaveValue('expense')
    })

    it('表の相手科目の「+ 科目を新規追加」でも、区分の既定は「費用」である', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

      fireEvent.click(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '相手科目' })).getByRole('button', { name: '+ 科目を新規追加' }))

      expect(within(screen.getByRole('dialog', { name: '科目を登録' })).getByLabelText('区分')).toHaveValue('expense')
    })

    it('表の相手科目から開いた科目の登録ダイアログも、body直下に出る(入れ子ではないので入れ子用のクラスは付かない。計画Issue #287)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,ニチケイ 3月,-1000,97000\n`)
      fireEvent.click(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^相手科目/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '相手科目' })).getByRole('button', { name: '+ 科目を新規追加' }))

      const backdrop = screen.getByRole('dialog', { name: '科目を登録' }).parentElement!
      expect(backdrop.parentElement).toBe(document.body)
      expect(backdrop).not.toHaveClass('import-dialog__backdrop--nested')
    })

    it('取込先の「+ 科目を新規追加」では、区分の既定は従来どおり「資産」のままである', async () => {
      makeMapping({ accountIds: [] })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)
      await findTargetAccountButton()

      fireEvent.click(screen.getByRole('button', { name: '+ 科目を新規追加' }))

      expect(within(screen.getByRole('dialog', { name: '科目を登録' })).getByLabelText('区分')).toHaveValue('asset')
    })
  })

  describe('取引先・プロジェクトの追加ダイアログ(計画Issue #207)', () => {
    const openCounterpartyDialog = (desc: RegExp) => {
      fireEvent.click(rowOf(desc).getByRole('button', { name: /^取引先/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先' })).getByRole('button', { name: '+ 取引先を新規追加' }))
    }
    const dialog = (name: string) => within(screen.getByRole('dialog', { name }))

    it('名前の入力欄はほかの項目と同じ見た目で、取引先グループ・キーワード(最初は行の摘要)・キーワードごとの科目(最初のキーワードは行の科目)が出る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')

      openCounterpartyDialog(/スーパー 新宿店/)

      expect(dialog('取引先を追加').getByLabelText('取引先名')).toHaveClass('import-control')
      expect(dialog('取引先を追加').getByRole('button', { name: /^取引先グループ: 未分類/ })).toBeInTheDocument()
      expect(dialog('取引先を追加').getByLabelText('キーワード1')).toHaveValue('スーパー 新宿店')
      expect(dialog('取引先を追加').getByText('新規')).toBeInTheDocument()
      expect(dialog('取引先を追加').getByRole('button', { name: /^キーワード1の科目: 食費/ })).toBeInTheDocument()
      // 共通の「科目」欄は無い(キーワードと科目のセットで入力する)
      expect(dialog('取引先を追加').queryByText('科目(上のキーワードに紐づける)')).not.toBeInTheDocument()
      // 保存の説明は出さない
      expect(screen.queryByText(/すぐ保存されます/)).not.toBeInTheDocument()
    })

    it('追加を押すと、取引先・グループ・キーワード(と科目)がまとめて保存され、その行に取引先が入る', async () => {
      makeMapping()
      const group = new SqlJsCounterpartyGroupRepository(db).create({ name: 'スーパー系' })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: /^取引先グループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先グループ' })).getByRole('button', { name: 'スーパー系' }))
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード2'), { target: { value: 'スーパー' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll().map((c) => c.name)).toEqual(['新しい店']))
      const created = counterparties.findAll()[0]
      expect(created.counterpartyGroupId).toBe(group.id)
      expect(keywordRules.findByCounterparty(created.id).map((p) => [p.pattern, p.accountId])).toEqual([
        ['スーパー新宿店', food.id],
        // 足したキーワードの科目は、ダイアログ内で最も多い科目(食費)が初期値(計画Issue #236)
        ['スーパー', food.id],
      ])
      expect(await rowOf(/スーパー 新宿店/).findByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
    })

    it('追加した行は、確定時に摘要が重ねてキーワード登録されない(ダイアログで決めた内容に従う)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)
      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      // 行の摘要のキーワードは消し、短いキーワードだけを登録する
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワード1を削除' }))
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード1'), { target: { value: '新宿' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))
      await waitFor(() => expect(counterparties.findAll()).toHaveLength(1))

      fireEvent.click(confirmButton(1))

      await waitFor(() => expect(userEntries()).toHaveLength(1))
      const created = counterparties.findAll()[0]
      expect(keywordRules.findByCounterparty(created.id).map((p) => p.pattern)).toEqual(['新宿'])
    })

    it('行の摘要にマッチしないキーワードは、注意を出したうえで登録できる(計画Issue #236)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード1'), { target: { value: 'ローソン' } })
      expect(dialog('取引先を追加').getByText('現在の明細の摘要とはマッチしないキーワードです。')).toBeInTheDocument()
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll()).toHaveLength(1))
      expect(keywordRules.findByCounterparty(counterparties.findAll()[0].id).map((p) => p.pattern)).toEqual(['ローソン'])
    })

    it('取引先名の初期値に、開いた行の摘要が入る(計画Issue #236)', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      openCounterpartyDialog(/スーパー 新宿店/)

      expect(dialog('取引先を追加').getByLabelText('取引先名')).toHaveValue('スーパー 新宿店')
    })

    it('キーワードごとに別の科目を選んで追加でき、キーワードと科目のセットとして保存される(新しく足したキーワードの科目は、最初は最も多い科目)', async () => {
      makeMapping()
      accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)
      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード2'), { target: { value: '新宿' } })
      expect(dialog('取引先を追加').getByRole('button', { name: /^キーワード2の科目: 食費/ })).toBeInTheDocument()

      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: /^キーワード2の科目/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'キーワード2の科目' })).getByRole('button', { name: '日用品費' }))
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll()).toHaveLength(1))
      const created = counterparties.findAll()[0]
      const daily = accounts.findAll().find((a) => a.name === '日用品費')!
      expect(keywordRules.findByCounterparty(created.id).map((r) => [r.pattern, r.accountId])).toEqual([
        ['スーパー新宿店', food.id],
        ['新宿', daily.id],
      ])
    })

    it('キーワードをすべて消すと、取引先だけを追加できる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワード1を削除' }))
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll()).toHaveLength(1))
      const created = counterparties.findAll()[0]
      expect(keywordRules.findByCounterparty(created.id)).toEqual([])
    })

    it('プロジェクトの追加ダイアログでもグループを選べ、選んだグループに属して作られる', async () => {
      makeMapping()
      const group = new SqlJsProjectGroupRepository(db).create({ name: '旅行系' })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')

      fireEvent.click(rowOf(/スーパー 新宿店/).getByRole('button', { name: /^プロジェクト/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクト' })).getByRole('button', { name: '+ プロジェクトを新規追加' }))
      expect(dialog('プロジェクトを追加').getByLabelText('プロジェクト名')).toHaveClass('import-control')
      fireEvent.change(dialog('プロジェクトを追加').getByLabelText('プロジェクト名'), { target: { value: '夏の旅行' } })
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '旅行系' }))
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(projects.findAll().map((p) => p.name)).toEqual(['夏の旅行']))
      expect(projects.findAll()[0].projectGroupId).toBe(group.id)
    })

    it('取引先グループの選択欄の「+ グループを新規追加」から名前だけでグループを作り、そのまま選んで取引先を追加できる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000
`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: /^取引先グループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先グループ' })).getByRole('button', { name: '+ グループを新規追加' }))
      fireEvent.change(dialog('取引先グループを追加').getByLabelText('グループ名'), { target: { value: '新しい系' } })
      fireEvent.click(dialog('取引先グループを追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(new SqlJsCounterpartyGroupRepository(db).findAll().map((g) => g.name)).toEqual(['新しい系']))
      expect(new SqlJsCounterpartyGroupRepository(db).findAll()[0].parentGroupId).toBeNull()
      // 作ったグループがそのまま選ばれ、グループの追加ダイアログは閉じる
      expect(await dialog('取引先を追加').findByRole('button', { name: /^取引先グループ: 新しい系/ })).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: '取引先グループを追加' })).not.toBeInTheDocument()

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll()).toHaveLength(1))
      expect(counterparties.findAll()[0].counterpartyGroupId).toBe(new SqlJsCounterpartyGroupRepository(db).findAll()[0].id)
    })

    it('プロジェクトグループもその場で作って選べる。グループの追加をキャンセルすると、何も作らず選択も変わらない', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000
`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      fireEvent.click(rowOf(/スーパー 新宿店/).getByRole('button', { name: /^プロジェクト/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクト' })).getByRole('button', { name: '+ プロジェクトを新規追加' }))

      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
      fireEvent.change(dialog('プロジェクトグループを追加').getByLabelText('グループ名'), { target: { value: '取り消す系' } })
      fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: 'キャンセル' }))
      expect(new SqlJsProjectGroupRepository(db).findAll()).toEqual([])
      expect(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ: 未分類/ })).toBeInTheDocument()

      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
      fireEvent.change(dialog('プロジェクトグループを追加').getByLabelText('グループ名'), { target: { value: '旅行系' } })
      fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: '追加' }))
      await waitFor(() => expect(new SqlJsProjectGroupRepository(db).findAll().map((g) => g.name)).toEqual(['旅行系']))
      fireEvent.change(dialog('プロジェクトを追加').getByLabelText('プロジェクト名'), { target: { value: '夏の旅行' } })
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(projects.findAll()).toHaveLength(1))
      expect(projects.findAll()[0].projectGroupId).toBe(new SqlJsProjectGroupRepository(db).findAll()[0].id)
    })

    it('取引先を追加できてもキーワードの保存に失敗したら、取引先は追加したうえで、保存できなかったキーワードがあることを知らせる', async () => {
      makeMapping()
      const failingRules = Object.assign(Object.create(keywordRules), {
        create: () => {
          throw new Error('保存の失敗')
        },
      }) as typeof keywordRules
      renderScreen(undefined, undefined, failingRules)
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(counterparties.findAll().map((c) => c.name)).toEqual(['新しい店']))
      expect(
        await screen.findByText('取引先は追加しましたが、保存できなかったキーワードがあります。取引先のキーワードのアイコンから追加してください。'),
      ).toBeInTheDocument()
      expect(await rowOf(/スーパー 新宿店/).findByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
    })

    it('グループを選ばずに追加すると、未分類で作られる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      fireEvent.click(rowOf(/スーパー 新宿店/).getByRole('button', { name: /^プロジェクト/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクト' })).getByRole('button', { name: '+ プロジェクトを新規追加' }))

      fireEvent.change(dialog('プロジェクトを追加').getByLabelText('プロジェクト名'), { target: { value: '夏の旅行' } })
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(projects.findAll()).toHaveLength(1))
      expect(projects.findAll()[0].projectGroupId).toBeNull()
    })
  })

  it('「+ 新規追加」から取引先をその場で作って、その行に選べる', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    fireEvent.click(rowOf(/スーパー/).getByRole('button', { name: /^取引先/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '取引先' })).getByRole('button', { name: '+ 取引先を新規追加' }))
    fireEvent.change(screen.getByLabelText('取引先名'), { target: { value: '新しい店' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(counterparties.findAll().map((c) => c.name)).toEqual(['新しい店']))
    expect(await rowOf(/スーパー/).findByRole('button', { name: /^取引先: 新しい店/ })).toBeInTheDocument()
  })

  it('列が同じで複数の定義に一致するときは、表示名で選ばせ、選ぶと取込先の確認に進む', async () => {
    makeMapping({ label: '汎用の定義', accountIds: [] })
    makeMapping({ label: '普通預金用' })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'マッピング定義: 選択してください' }))
    const dialog = within(screen.getByRole('dialog', { name: 'マッピング定義' }))
    expect(dialog.getAllByRole('button').map((b) => b.textContent)).toEqual(['汎用の定義', '普通預金用'])
    fireEvent.click(dialog.getByRole('button', { name: '普通預金用' }))
    await screen.findByText(/statement\.csv を読み込み済み/)
    expectTargetAccount(bank.name)
  })

  it('定義に紐づく科目が1つだけなら、その科目が自動で取込先になる', async () => {
    makeMapping({ accountIds: [bank.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    expectTargetAccount(bank.name)
  })

  it('定義に紐づく科目が複数あるときは自動で決めず、取込先を選ぶまで一覧を出さない。選ぶと取り込める', async () => {
    const card = accounts.create({ category: 'liability', name: '楽天VISA', isReconcilable: false, hasExternalStatement: true })
    makeMapping({ accountIds: [bank.id, card.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    await findTargetAccountButton()
    expectTargetAccount(null)
    expect(screen.getByText('科目を選ぶと、明細の一覧を表示します。')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
    await chooseTargetAccount(card.name)
    await screen.findByRole('button', { name: /^\d+ \/ 1 件を「楽天VISA」に確定$/ })
    chooseMember('誰の明細か(必須)', '自分')
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「楽天VISA」に確定$/ }))

    await screen.findByText(/確定しました/)
    const accountIds = userEntries()[0].lines.map((l) => l.accountId)
    expect(accountIds).toContain(card.id)
    expect(accountIds).not.toContain(bank.id)
  })

  it('紐づく科目が無い定義では、取込先を選ぶまで一覧を出さず、選んで確定すると紐づけを追加する', async () => {
    const only = makeMapping({ accountIds: [] })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    await findTargetAccountButton()
    expectTargetAccount(null)
    expect(screen.getByText('科目を選ぶと、明細の一覧を表示します。')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '明細の一覧' })).not.toBeInTheDocument()

    await chooseTargetAccount(bank.name)
    await screen.findByText(/statement\.csv を読み込み済み/)
    chooseMember('誰の明細か(必須)', '自分')
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))

    await screen.findByText(/確定しました/)
    expect(mappings.findById(only.id)?.accountIds).toEqual([bank.id])
  })

  it('定義に紐づく取込先が選ばれているときは、「このマッピングは…に紐づいています」の案内を出さない(計画Issue #218)', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    expect(screen.queryByText(/このマッピングは.*に紐づいています/)).not.toBeInTheDocument()
  })

  it('定義がまだどの科目にも紐づいていないときの案内は、これまでどおり出る', async () => {
    makeMapping({ accountIds: [] })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    expect(await screen.findByText(/このマッピングは、まだどの科目にも紐づいていません/)).toBeInTheDocument()
  })

  it('取込先の「+ 科目を新規追加」では、いま取り込んでいる定義が最初から選ばれ、登録すると紐づく(計画Issue #189)', async () => {
    const current = makeMapping({ accountIds: [] })
    // CSVには一致しない定義(取込先の選択は current だけで決まる)
    const other = makeMapping({ formatGroupId: '別の銀行', label: '別の定義', dateColumn: '存在しない列', accountIds: [] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)
    await findTargetAccountButton()

    fireEvent.click(screen.getByRole('button', { name: '+ 科目を新規追加' }))

    const dialog = within(screen.getByRole('dialog', { name: '科目を登録' }))
    // いま取り込んでいる定義は、最初から選ばれた状態(チップ)で出る。ほかの定義はチップに出ない
    const chips = within(dialog.getByRole('list'))
    expect(chips.getByText('マイ銀行')).toBeInTheDocument()
    expect(chips.queryByText('別の定義')).not.toBeInTheDocument()

    fireEvent.change(dialog.getByLabelText('名称'), { target: { value: '新しい口座' } })
    fireEvent.click(dialog.getByRole('button', { name: '登録' }))

    await waitFor(() => {
      const created = accounts.findAll().find((a) => a.name === '新しい口座')
      expect(created).toBeDefined()
      expect(mappings.findById(current.id)?.accountIds).toEqual([created!.id])
      expect(mappings.findById(other.id)?.accountIds).toEqual([])
    })
  })

  it('マッピング作成ダイアログの金融機関名には、既存の定義の金融機関名が候補として並ぶ(計画Issue #183)', async () => {
    // 列が合わない定義にして、CSVとは一致しない(=新規作成に進む)ようにする
    makeMapping({ formatGroupId: '楽天カード', label: '楽天カード', dateColumn: '存在しない列', accountIds: [] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))

    expect(dialog.getByRole('option', { name: '楽天カード' })).toBeInTheDocument()
    expect(dialog.getByRole('option', { name: '新しい金融機関名を入力…' })).toBeInTheDocument()
  })

  it('一致する定義が無いときは、CSVを元に画面内でマッピングを作って続けて取り込める', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    expect(dialog.getByText('列を推測しました。内容を確認してください')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '保存して取り込む' })).toBeDisabled()
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '新しい銀行' } })
    enterInstitution(dialog, 'new-bank')
    expect(dialog.queryByText(/取り込み結果のプレビュー/)).not.toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '保存して取り込む' }))

    // 作った定義はどの科目にも紐づいていないので、取込先を選ぶ
    await findTargetAccountButton()
    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
    expect(mappings.findAll()[0]).toMatchObject({ label: '新しい銀行', formatGroupId: 'new-bank', dateColumn: '日付' })
    await chooseTargetAccount(bank.name)
    expect(await screen.findByText(/statement\.csv を読み込み済み/)).toBeInTheDocument()
  })

  it('定義の作成ダイアログで「金額の符号を反転する」にチェックして保存すると、反転する定義が作られる(計画Issue #192)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    expect(dialog.getByLabelText('金額の符号を反転する')).not.toBeChecked()
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '反転する銀行' } })
    enterInstitution(dialog, 'invert-bank')
    fireEvent.click(dialog.getByLabelText('金額の符号を反転する'))
    fireEvent.click(dialog.getByRole('button', { name: '保存して取り込む' }))

    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
    expect(mappings.findAll()[0].invertAmountSign).toBe(true)
  })

  it('定義の作成ダイアログで金額の形式を入金・出金の2列にすると、反転のチェックは出ない(計画Issue #192)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    fireEvent.change(dialog.getByLabelText('金額の形式'), { target: { value: 'debit_credit_split' } })

    expect(dialog.queryByLabelText('金額の符号を反転する')).not.toBeInTheDocument()
  })

  it('定義の作成ダイアログには、取り込み前の元のCSVが表示され、割り当てた列の見出しに役割が出る', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))

    // 元のCSVは、取り込み結果には出ない列(残高)も含めて、そのままの値で見える
    const raw = within(dialog.getByRole('table', { name: '元のCSV' }))
    expect(raw.getByText('2026/10/05')).toBeInTheDocument()
    expect(raw.getByText('-3000')).toBeInTheDocument()
    expect(raw.getByText('97000')).toBeInTheDocument()
    // 推測した列の見出しに、割り当てた役割が表示される
    expect(raw.getByRole('columnheader', { name: /日付.*取引日/ })).toBeInTheDocument()
    expect(raw.getByRole('columnheader', { name: /金額.*金額/ })).toBeInTheDocument()
    expect(raw.getByRole('columnheader', { name: /残高/ })).not.toHaveTextContent('取引日')

    // 列の割り当てを変えると、見出しの役割も付け替わる
    fireEvent.change(dialog.getByLabelText('摘要の列'), { target: { value: '残高' } })
    expect(raw.getByRole('columnheader', { name: /残高.*摘要/ })).toBeInTheDocument()
  })

  it('日付が空の補足行など読み取れない行があっても取り込め、その行は「取り込まない行」に理由つきで出る(計画Issue #151)', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n,為替レート 1ドル=150円,,\n`)

    expect(rowOf(/スーパー/).getByText('2026/10/05')).toBeInTheDocument()
    // 読めない行は、3つ目の「取り込まない行」タブに出る(計画Issue #263)
    fireEvent.click(await screen.findByRole('tab', { name: /^取り込まない行/ }))
    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(1件)' }))
    expect(skipped.getByText(/3行目/)).toBeInTheDocument()
    expect(skipped.getByText(/為替レート 1ドル=150円/)).toBeInTheDocument()
    expect(skipped.getByText(/日付を読み取れません/)).toBeInTheDocument()

    openTab('新規')
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)
    expect(userEntries()).toHaveLength(1)
  })

  it('読み取れない行の方が多いときは、取り込めるが、マッピングが合っているか確認する警告を出す(計画Issue #151)', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n,補足1,,\n,補足2,,\n`)

    // 警告は、タブの札と、「取り込まない行」タブの先頭に出る(計画Issue #263)
    expect(await screen.findByText('要確認', { selector: '.import-tab__state' })).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByText('2026/10/05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /^取り込まない行/ }))
    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(2件)' }))
    expect(skipped.getByText(/読み取れない行の方が多いです/)).toBeInTheDocument()
  })

  it('読み取れない行が少ないときは、警告は出さない', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n,補足,,\n`)

    fireEvent.click(await screen.findByRole('tab', { name: /^取り込まない行/ }))
    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(1件)' }))
    expect(skipped.queryByText(/読み取れない行の方が多いです/)).not.toBeInTheDocument()
    expect(screen.queryByText('要確認', { selector: '.import-tab__state' })).not.toBeInTheDocument()
  })

  it('定義の作成ダイアログは、読み取れない行の方が多くても読める行が1行あれば保存でき、警告を出す(計画Issue #151)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n,補足1,,\n,補足2,,\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '補足行が多い' } })
    enterInstitution(dialog, 'many-notes')

    expect(dialog.getByText(/読み取れない行の方が多いです/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '保存して取り込む' })).toBeEnabled()
    fireEvent.click(dialog.getByRole('button', { name: '保存して取り込む' }))

    // 保存した定義が、そのまま取り込みに進める(一致しないと「保存できませんでした」になる)
    await findTargetAccountButton()
    expect(screen.queryByText('保存できませんでした。もう一度お試しください。')).not.toBeInTheDocument()
    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
  })

  it('定義の作成ダイアログは、読み取れる行が1行も無いと保存できず、理由を出す(計画Issue #151)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '書式違い' } })
    enterInstitution(dialog, 'bad-format')
    fireEvent.change(dialog.getByLabelText('日付の書式'), { target: { value: 'YYYY-MM-DD' } })

    expect(dialog.getByRole('button', { name: '保存して取り込む' })).toBeDisabled()
    expect(dialog.getByText('1行を読み取れません(全1行)')).toBeInTheDocument()
  })

  it('定義の作成ダイアログは、読み取れない行があっても保存でき、その行は取り込まれない旨を示す(計画Issue #151)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n,為替レート 1ドル=150円,,\n`, false)

    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '補足行つき' } })
    enterInstitution(dialog, 'with-notes')

    // 取り込み結果のプレビューは出さない。読み取れない行があっても、その旨の注記だけで保存できる
    expect(dialog.getByText(/読み取れない行は取り込まれません/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '保存して取り込む' })).toBeEnabled()
    fireEvent.click(dialog.getByRole('button', { name: '保存して取り込む' }))

    await findTargetAccountButton()
    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
  })

  it('一致する定義が無いとき、ダイアログをキャンセルすると元の案内に戻る', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)
    fireEvent.click(await screen.findByRole('button', { name: 'このCSVでマッピングを新規作成' }))

    fireEvent.click(within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' })).getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('dialog', { name: 'マッピングを新規作成' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'このCSVでマッピングを新規作成' })).toBeInTheDocument()
  })

  it('「マッピングを編集」を押すと、マスタの明細マッピングへ移動するコールバックが呼ばれる', async () => {
    renderScreen()

    fireEvent.click(await screen.findByRole('button', { name: 'マッピングを編集' }))

    expect(onEditMappings).toHaveBeenCalledTimes(1)
  })

  describe('一覧のタブとページ送り(計画Issue #263)', () => {
    /** ランチ(10/06・800円)に似た取引ができるよう、手入力の仕訳を1件作る */
    function manualLunch() {
      return entries.create({
        householdMemberId: memberId,
        entryDate: '2026-10-06',
        memo: 'ランチ',
        sourceType: 'manual',
        lines: [
          { householdMemberId: memberId, accountId: food.id, side: 'debit', amount: 800 },
          { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount: 800 },
        ],
      })
    }
    /** ふつうの行2件(スーパー・家賃)、似た取引がある行1件(ランチ) */
    const CSV = `${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
2026/10/07,家賃,-50000,46200
`
    /** n行のCSV(1ページ分の件数を超える行数で、ページ送りを確かめる)。摘要は「店001」「店002」… */
    const manyRows = (n: number) =>
      HEADER + Array.from({ length: n }, (_, i) => `2026/10/05,店${String(i + 1).padStart(3, '0')},-100,100`).join('\n') + '\n'
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
    /** 1ページの件数と、1ページに収まらない行数(1ページ分より10行多い) */
    const PAGE = IMPORT_PAGE_SIZE
    const TOTAL = PAGE + 10
    const rowLabel = (n: number) => `店${String(n).padStart(3, '0')}`

    it('初期表示は「新規」タブが開いていて、件数と状態の札(似た取引・未入力)が出る。行のないタブは出さない', async () => {
      makeMapping()
      manualLunch()
      renderScreen()
      await chooseCsv(CSV)

      expect(tab('新規')).toHaveAttribute('aria-selected', 'true')
      expect(within(tab('新規')).getByText('3')).toBeInTheDocument()
      expect(within(tab('新規')).getByText('似た取引 1')).toBeInTheDocument()
      expect(within(tab('新規')).getByText('未入力 3')).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: /^重複/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: /^取り込まない行/ })).not.toBeInTheDocument()
      expect(screen.getAllByRole('row', { name: /スーパー/ }).length).toBeGreaterThan(0)
      expect(screen.getAllByRole('row', { name: /ランチ/ }).length).toBeGreaterThan(0)
    })

    it('入力すると「未入力」の札の件数が減り、すべて入力すると札が消える', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/07,家賃,-50000,47000\n`)
      expect(within(tab('新規')).getByText('未入力 2')).toBeInTheDocument()

      pick(rowOf(/スーパー/), '相手科目', '食費')
      expect(within(tab('新規')).getByText('未入力 1')).toBeInTheDocument()

      pick(rowOf(/家賃/), '相手科目', '食費')
      expect(within(tab('新規')).queryByText(/未入力/)).not.toBeInTheDocument()
    })

    it('重複の行は「重複」タブに分かれ、タブを切り替えると表示する行が入れ替わる。重複のタブは折りたたまず、普通に開く', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
      await screen.findByText(/確定しました/)
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/07,家賃,-50000,47000\n`)

      expect(await screen.findByRole('tab', { name: /^重複/ })).toHaveAttribute('aria-selected', 'false')
      expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
      expect(screen.getAllByRole('row', { name: /家賃/ }).length).toBeGreaterThan(0)

      openTab('重複')

      expect(tab('重複')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getAllByRole('row', { name: /スーパー/ }).length).toBeGreaterThan(0)
      expect(screen.queryByRole('row', { name: /家賃/ })).not.toBeInTheDocument()
      // 確認不要のタブには、状態の札を付けない
      expect(within(tab('重複')).queryByText(/未入力|要対応|似た取引/)).not.toBeInTheDocument()
    })

    it('タブを切り替えて戻っても、行の入力内容は失われない', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
      await screen.findByText(/確定しました/)
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/07,家賃,-50000,47000\n`)
      await screen.findByRole('tab', { name: /^重複/ })
      fireEvent.change(screen.getByLabelText('家賃のコメント'), { target: { value: '10月分' } })

      openTab('重複')
      openTab('新規')

      expect(screen.getByLabelText('家賃のコメント')).toHaveValue('10月分')
    })

    it('1ページに表示するのは決めた件数までで、「1–N / M件」とページ番号を出し、次のページで残りを表示する', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(manyRows(TOTAL))

      expect(screen.getByText(`1–${PAGE} / ${TOTAL}件`)).toBeInTheDocument()
      expect(screen.getAllByRole('row', { name: /店001/ }).length).toBeGreaterThan(0)
      expect(screen.getAllByRole('row', { name: new RegExp(rowLabel(PAGE)) }).length).toBeGreaterThan(0)
      expect(screen.queryByRole('row', { name: new RegExp(rowLabel(PAGE + 1)) })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '次のページ' }))

      expect(screen.getByText(`${PAGE + 1}–${TOTAL} / ${TOTAL}件`)).toBeInTheDocument()
      expect(screen.getAllByRole('row', { name: new RegExp(rowLabel(PAGE + 1)) }).length).toBeGreaterThan(0)
      expect(screen.queryByRole('row', { name: /店001/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '2ページ目' })).toHaveAttribute('aria-current', 'page')
    })

    it('ページを切り替えても、ほかのページで入力した内容は残る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(manyRows(TOTAL))
      fireEvent.change(screen.getByLabelText('店001のコメント'), { target: { value: '1ページ目のメモ' } })

      fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
      fireEvent.click(screen.getByRole('button', { name: '前のページ' }))

      expect(screen.getByLabelText('店001のコメント')).toHaveValue('1ページ目のメモ')
    })

    it('見出しのチェックは、表示中のページの行だけを選び、一括設定の対象もその行だけ。ページを切り替えると選択は外れる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(manyRows(TOTAL))

      fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))

      expect(within(screen.getByRole('group', { name: '選択した明細への一括設定' })).getByText(`${PAGE}件に一括設定`)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '次のページ' }))

      expect(screen.queryByRole('group', { name: '選択した明細への一括設定' })).not.toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' })).not.toBeChecked()
    })

    it('確定の件数と確定は、見えていないページの行も含めた全件が対象で、確定した行は一覧から外れる', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(manyRows(TOTAL))
      // 1ページ目の分(PAGE件)をまとめて入力して、確定する
      fireEvent.click(screen.getByRole('checkbox', { name: '新規の明細をすべて選択' }))
      const bulk = within(screen.getByRole('group', { name: '選択した明細への一括設定' }))
      fireEvent.click(bulk.getByRole('button', { name: /^一括の相手科目/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '一括の相手科目' })).getByRole('button', { name: '食費' }))

      expect(screen.getByRole('button', { name: `${PAGE} / ${TOTAL} 件を「普通預金」に確定` })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: `${PAGE} / ${TOTAL} 件を「普通預金」に確定` }))

      await screen.findByText(new RegExp(`${PAGE}件を確定しました。未入力の10件は確定していません`))
      expect(userEntries()).toHaveLength(PAGE)
      // 残りの10件は、1ページ目に繰り上がる
      expect(screen.getByText('1–10 / 10件')).toBeInTheDocument()
    })

    it('新しいCSVを選び直すと、開くタブとページは最初(「新規」の1ページ目)に戻る', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(manyRows(TOTAL))
      fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
      expect(screen.getByText(`${PAGE + 1}–${TOTAL} / ${TOTAL}件`)).toBeInTheDocument()

      await chooseCsv(manyRows(TOTAL))

      await waitFor(() => expect(screen.getByText(`1–${PAGE} / ${TOTAL}件`)).toBeInTheDocument())
    })
  })

  describe('入力済み/未入力の色分けとヘッダーでの並び替え(計画Issue #231 フェーズ2)', () => {
    /** 金額の昇順は 家賃 → スーパー → ランチ、日付の昇順は スーパー → ランチ → 家賃 */
    const CSV3 = `${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
2026/10/07,家賃,-50000,46200
`
    const rowEl = (text: RegExp) => screen.getAllByRole('row', { name: text })[0]
    const isBefore = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const header = (name: string) => screen.getByRole('columnheader', { name })
    const sortButton = (name: string) => within(header(name)).getByRole('button')
    /** 一覧の行(明細の行)を上から並べた摘要 */
    const descriptions = () =>
      ['スーパー', 'ランチ', '家賃']
        .map((d) => ({ d, el: rowEl(new RegExp(d)) }))
        .sort((a, b) => (isBefore(a.el, b.el) ? -1 : 1))
        .map((x) => x.d)
    function manualLunch() {
      return entries.create({
        householdMemberId: memberId,
        entryDate: '2026-10-06',
        memo: 'ランチ',
        sourceType: 'manual',
        lines: [
          { householdMemberId: memberId, accountId: food.id, side: 'debit', amount: 800 },
          { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount: 800 },
        ],
      })
    }

    describe('色分け', () => {
      it('相手科目が決まった行は入力済みの色(import-row--done)になり、未設定の行にはその色が付かない。状態の文字は従来どおり', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        expect(rowEl(/スーパー/)).not.toHaveClass('import-row--done')
        expect(within(rowEl(/スーパー/)).getByText('要確認')).toBeInTheDocument()

        pick(rowOf(/スーパー/), '相手科目', '食費')

        expect(rowEl(/スーパー/)).toHaveClass('import-row--done')
        expect(within(rowEl(/スーパー/)).getByText('新規')).toBeInTheDocument()
        expect(rowEl(/家賃/)).not.toHaveClass('import-row--done')
      })

      it('状態の文字には、色だけに頼らないよう、入力済みには✓、未入力には破線の丸のマークを添える(読み上げは文字のまま)', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/スーパー/), '相手科目', '食費')

        expect(rowEl(/スーパー/).querySelector('.import-status__mark--done')).not.toBeNull()
        expect(rowEl(/家賃/).querySelector('.import-status__mark--todo')).not.toBeNull()
        expect(rowEl(/スーパー/).querySelector('.import-status svg')).toHaveAttribute('aria-hidden', 'true')
      })

      it('「似た取引あり」の行も、相手科目を決めると入力済みの色になり、直下の確認の行も同じ色になる(未入力のときは従来の黄色)', async () => {
        makeMapping()
        manualLunch()
        renderScreen()
        await chooseCsv(CSV3)
        const confirmRow = () => screen.getByRole('group', { name: 'ランチの似た取引の確認' }).closest('tr')!
        expect(rowEl(/ランチ/)).not.toHaveClass('import-row--done')
        expect(confirmRow()).not.toHaveClass('import-sub--done')

        pick(rowOf(/ランチ/), '相手科目', '食費')

        expect(rowEl(/ランチ/)).toHaveClass('import-row--done')
        expect(rowEl(/ランチ/)).toHaveClass('import-row--similar')
        expect(confirmRow()).toHaveClass('import-sub--done')
      })

      it('「この取引を保存しない」の行は、相手科目があっても入力済みの色にしない(従来のグレーのまま)', async () => {
        makeMapping()
        manualLunch()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/ランチ/), '相手科目', '食費')

        fireEvent.click(await screen.findByRole('radio', { name: 'この取引を保存しない' }))

        expect(rowEl(/ランチ/)).not.toHaveClass('import-row--done')
        expect(rowEl(/ランチ/)).toHaveClass('import-row--skipped')
      })

      it('「この取引を保存しない」の行は、世帯メンバーの欄が押せなくなる', async () => {
        makeMapping()
        manualLunch()
        renderScreen()
        await chooseCsv(CSV3)
        expect(findMemberButton('ランチの世帯メンバー', rowOf(/ランチ/))).toBeEnabled()

        fireEvent.click(await screen.findByRole('radio', { name: 'この取引を保存しない' }))

        expect(findMemberButton('ランチの世帯メンバー', rowOf(/ランチ/))).toBeDisabled()
      })

      it('「この取引を保存しない」の行は、精算バッチの欄が押せなくなる', async () => {
        makeMapping()
        manualLunch()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/ランチ/), '相手科目', '立替金')
        expect(findBatchButton('ランチの精算バッチ', rowOf(/ランチ/))).toBeEnabled()

        fireEvent.click(await screen.findByRole('radio', { name: 'この取引を保存しない' }))

        expect(findBatchButton('ランチの精算バッチ', rowOf(/ランチ/))).toBeDisabled()
      })
    })

    describe('並び替え', () => {
      it('日付・摘要・金額・相手科目・取引先・状態のヘッダーはボタンで、チェック・プロジェクト・メンバー・コメントの列はボタンにしない', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)

        for (const name of ['日付', '摘要', '金額', '相手科目', '取引先・精算バッチ', '状態']) {
          expect(within(header(name)).getByRole('button')).toBeInTheDocument()
        }
        for (const name of ['プロジェクト', 'メンバー', 'コメント']) {
          expect(within(header(name)).queryByRole('button')).not.toBeInTheDocument()
        }
      })

      it('ヘッダーを押すと 昇順 → 降順 → 解除(取り込んだ順)と切り替わり、aria-sort が今の状態を伝える', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        expect(header('金額')).toHaveAttribute('aria-sort', 'none')
        expect(descriptions()).toEqual(['スーパー', 'ランチ', '家賃'])

        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')
        expect(descriptions()).toEqual(['家賃', 'スーパー', 'ランチ'])

        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'descending')
        expect(descriptions()).toEqual(['ランチ', 'スーパー', '家賃'])

        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'none')
        expect(descriptions()).toEqual(['スーパー', 'ランチ', '家賃'])
      })

      it('別の列を押すと、前の列の並び替えは外れて、その列の昇順になる', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        fireEvent.click(sortButton('金額'))

        fireEvent.click(sortButton('日付'))

        expect(header('金額')).toHaveAttribute('aria-sort', 'none')
        expect(header('日付')).toHaveAttribute('aria-sort', 'ascending')
        expect(descriptions()).toEqual(['スーパー', 'ランチ', '家賃'])
      })

      it('「新規」タブでは、並び替えても似た取引がある行が先頭のままで、その後ろの行が並び替えの順になる(計画Issue #263)', async () => {
        makeMapping()
        manualLunch()
        renderScreen()
        await chooseCsv(CSV3)

        // 金額の昇順では 家賃(-50,000) が先頭になるが、似た取引がある ランチ は先頭に寄ったまま動かない
        fireEvent.click(sortButton('金額'))

        expect(descriptions()).toEqual(['ランチ', '家賃', 'スーパー'])
      })

      it('並び替えたあとに行へ入力しても、行は動かない(ヘッダーを押した時点の並びを保つ)', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/スーパー/), '相手科目', '食費')

        // 状態の昇順: 要確認(ランチ・家賃)が先、新規(スーパー)が後
        fireEvent.click(sortButton('状態'))
        expect(descriptions()).toEqual(['ランチ', '家賃', 'スーパー'])

        // 先頭の ランチ を入力済み(新規)にしても、並びは変わらない(いま計算し直すと スーパー と ランチ が入れ替わる)
        pick(rowOf(/ランチ/), '相手科目', '食費')

        expect(descriptions()).toEqual(['ランチ', '家賃', 'スーパー'])
      })

      it('並び替えても、行の入力内容と選択は保たれる', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/スーパー/), '相手科目', '食費')
        fireEvent.change(screen.getByLabelText('スーパーのコメント'), { target: { value: '買い出し' } })
        fireEvent.click(screen.getByLabelText('スーパーを選択'))

        fireEvent.click(sortButton('金額'))

        expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
        expect(screen.getByLabelText('スーパーのコメント')).toHaveValue('買い出し')
        expect(screen.getByLabelText('スーパーを選択')).toBeChecked()
        expect(screen.getByLabelText('ランチを選択')).not.toBeChecked()
      })

      it('並び替えても、保存時の並び(rowOrder)は元のCSVの順のまま', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/スーパー/), '相手科目', '食費')
        pick(rowOf(/ランチ/), '相手科目', '食費')
        pick(rowOf(/家賃/), '相手科目', '食費')
        fireEvent.click(sortButton('日付'))
        fireEvent.click(sortButton('日付'))
        expect(descriptions()).toEqual(['家賃', 'ランチ', 'スーパー'])

        fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 3 件を「普通預金」に確定$/ }))

        await screen.findByText(/確定しました/)
        const refs = new SqlJsExternalTransactionRefRepository(db).findByAccount(bank.id)
        const orderOf = (description: string) => refs.find((r) => r.description === description)?.rowOrder
        expect([orderOf('スーパー'), orderOf('ランチ'), orderOf('家賃')]).toEqual([0, 1, 2])
      })

      it('新しいCSVを選び直すと、並び替えは解除される', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')

        await chooseCsv(CSV3)

        await waitFor(() => expect(header('金額')).toHaveAttribute('aria-sort', 'none'))
        expect(descriptions()).toEqual(['スーパー', 'ランチ', '家賃'])
      })

      it('ヘッダーの並び替えはフォーカスできる本物のボタン(type=button)で、Enter・Spaceの操作はブラウザ標準の動きに任せる(実ブラウザでの操作はE2Eで確認)', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)

        for (const name of ['日付', '摘要', '金額', '相手科目', '取引先・精算バッチ', '状態']) {
          const button = sortButton(name)
          expect(button.tagName).toBe('BUTTON')
          expect(button).toHaveAttribute('type', 'button')
          expect(button).not.toHaveAttribute('tabindex', '-1')
          button.focus()
          expect(button).toHaveFocus()
        }
      })

      it('複数の行を選んだまま並び替えても選択は保たれ、そのあとの一括操作は選んだ行だけに反映される', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        fireEvent.click(screen.getByLabelText('スーパーを選択'))
        fireEvent.click(screen.getByLabelText('ランチを選択'))

        fireEvent.click(sortButton('金額'))

        expect(screen.getByLabelText('スーパーを選択')).toBeChecked()
        expect(screen.getByLabelText('ランチを選択')).toBeChecked()
        expect(screen.getByLabelText('家賃を選択')).not.toBeChecked()
        const bulk = openBulkGroup()
        expect(bulk.getByText('2件に一括設定')).toBeInTheDocument()
        fireEvent.change(bulk.getByLabelText('一括で設定するコメント'), { target: { value: '選んだ分だけ' } })
        fireEvent.click(bulk.getByRole('button', { name: 'コメントを適用' }))

        expect(screen.getByLabelText('スーパーのコメント')).toHaveValue('選んだ分だけ')
        expect(screen.getByLabelText('ランチのコメント')).toHaveValue('選んだ分だけ')
        expect(screen.getByLabelText('家賃のコメント')).toHaveValue('')
      })

      it('一部だけ確定して残りを続けるとき、確定した行は一覧から消え、残りの行の色分けと並び替えの状態は保たれる', async () => {
        makeMapping()
        renderScreen()
        await chooseCsv(CSV3)
        pick(rowOf(/スーパー/), '相手科目', '食費')
        pick(rowOf(/家賃/), '相手科目', '食費')
        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')

        // ランチは相手科目が未選択なので確定できず残る(部分確定)
        fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 3 件を「普通預金」に確定$/ }))

        await screen.findByText(/2件を確定しました。未入力の1件は確定していません/)
        expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('row', { name: /家賃/ })).not.toBeInTheDocument()
        // 残った行は未入力のままなので入力済みの色は付かず、入力すると付く
        expect(rowEl(/ランチ/)).not.toHaveClass('import-row--done')
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')
        pick(rowOf(/ランチ/), '相手科目', '食費')
        expect(rowEl(/ランチ/)).toHaveClass('import-row--done')
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')
      })

      it('取込先の科目を変えると、並び替えは解除される', async () => {
        const other = accounts.create({ category: 'asset', name: '別の預金', isReconcilable: true })
        makeMapping({ accountIds: [bank.id, other.id] })
        renderScreen()
        await chooseCsv(CSV3, false)
        await chooseTargetAccount(bank.name)
        await screen.findByText(/statement\.csv を読み込み済み/)
        fireEvent.click(sortButton('金額'))
        expect(header('金額')).toHaveAttribute('aria-sort', 'ascending')

        await chooseTargetAccount(other.name)

        await waitFor(() => expect(header('金額')).toHaveAttribute('aria-sort', 'none'))
      })
    })
  })

  describe('確定ボタンの「いま投入できる件数 / 全件」', () => {
    const CSV3 = `${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
2026/10/07,家賃,-50000,46200
`
    /** 確定ボタン。ready=相手科目が決まっていて、いま投入できる件数、total=取り込み対象の全件 */
    const confirmOf = (ready: number, total: number, account = '普通預金') =>
      screen.getByRole('button', { name: new RegExp(`^${ready} / ${total} 件を「${account}」に確定$`) })
    function manualEntry(entryDate: string, amount: number, memo: string) {
      return entries.create({
        householdMemberId: memberId,
        entryDate,
        memo,
        sourceType: 'manual',
        lines: [
          { householdMemberId: memberId, accountId: food.id, side: 'debit', amount },
          { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount },
        ],
      })
    }

    it('相手科目が決まった行の数を「投入できる件数」として、取り込み対象の全件とあわせて「N / M 件」と出し、入力すると増える', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(CSV3)
      expect(confirmOf(0, 3)).toBeInTheDocument()

      pick(rowOf(/スーパー/), '相手科目', '食費')
      expect(confirmOf(1, 3)).toBeInTheDocument()

      pick(rowOf(/ランチ/), '相手科目', '食費')
      pick(rowOf(/家賃/), '相手科目', '食費')
      expect(confirmOf(3, 3)).toBeEnabled()
    })

    it('「この取引を保存しない」の行は、全件にも投入できる件数にも数えない', async () => {
      makeMapping()
      manualEntry('2026-10-06', 800, 'ランチ')
      renderScreen()
      await chooseCsv(CSV3)
      pick(rowOf(/ランチ/), '相手科目', '食費')
      expect(confirmOf(1, 3)).toBeInTheDocument()

      fireEvent.click(await screen.findByRole('radio', { name: 'この取引を保存しない' }))

      expect(confirmOf(0, 2)).toBeInTheDocument()
    })

    it('「置き換える」を選んだのに削除する登録済みの仕訳が決まっていない行は、投入できる件数に数えない', async () => {
      makeMapping()
      manualEntry('2026-10-04', 3000, '近い方')
      const other = manualEntry('2026-10-03', 3060, '遠い方')
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      expect(confirmOf(1, 1)).toBeInTheDocument()

      fireEvent.click(await screen.findByRole('radio', { name: '同じ取引なので、登録済みを削除して置き換える' }))
      expect(confirmOf(0, 1)).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('削除する登録済みの仕訳'), { target: { value: String(other.id) } })
      expect(confirmOf(1, 1)).toBeInTheDocument()
    })

    it('一部だけ確定すると、確定した行は全件からも外れ、残りの件数で出し直す', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(CSV3)
      pick(rowOf(/スーパー/), '相手科目', '食費')
      pick(rowOf(/家賃/), '相手科目', '食費')
      expect(confirmOf(2, 3)).toBeInTheDocument()

      fireEvent.click(confirmOf(2, 3))

      await screen.findByText(/2件を確定しました。未入力の1件は確定していません/)
      expect(confirmOf(0, 1)).toBeInTheDocument()
    })
  })
})
