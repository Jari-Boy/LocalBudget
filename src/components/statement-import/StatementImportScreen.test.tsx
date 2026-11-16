// @vitest-environment jsdom
/**
 * StatementImportScreen(明細取込画面、計画Issue #151)のコンポーネントテスト。
 * アップロードとレビューを1画面にまとめた画面: CSVの選択、全マッピング定義への実パース試行による絞り込み
 * (1つなら自動選択・複数なら選択)、定義に紐づく科目を初期値にした取込先の確認と変更(紐づく科目が無ければ
 * 選ぶまで一覧を出さない、取り込むと紐づけを追加)、一致する定義が無いときの画面内での定義の作成、1件1行の一覧、キーワードルールによる取引先・相手科目の推定と
 * (キーワードに紐づく科目の)初期入力、重複の行(入力・選択なし、「取り込む」で戻せる)、選択した行への一括設定
 * (対象外の件数)、確定版の候補の置き換え、残高照合、確定とキーワード登録、確定後に続けて次のCSVを
 * 取り込めることを、sql.jsのNode実装(createTestDatabase)を使って確認する。
 * CSVを選ぶ前の画面中央の「CSVを選択」ボタンと、編集中に新しいCSVを選ぼうとしたときの警告(計画Issue #193)、
 * 編集中に他の画面へ移ろうとしたときの未保存の警告(保存して移動・破棄して移動・キャンセル・設定オフ、計画Issue #193)も確認する。
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
import { UnsavedGuardHarness } from '../master/UnsavedGuardHarness'
import { StatementImportScreen } from './StatementImportScreen'

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
    const owner = screen.queryByLabelText('誰の明細か(必須)')
    if (owner) fireEvent.change(owner, { target: { value: String(memberId) } })
  }
}

/** 補助行(確定版の確認・キーワード登録)にも同じ摘要の文字列が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

/** 行の「取引先の設定」(計画Issue #207)を開く。開いたあとのポップアップは settings() で、操作のたびに取り直して使う */
async function openCounterpartySettings(desc: string) {
  fireEvent.click(rowOf(new RegExp(desc)).getByRole('button', { name: `${desc}の取引先の設定` }))
  await screen.findByRole('dialog', { name: /^取引先の設定: / })
}
const settings = () => within(screen.getByRole('dialog', { name: /^取引先の設定: / }))
const confirmButton = (count: number) => screen.getByRole('button', { name: new RegExp(`^${count} 件を「普通預金」に確定$`) })

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
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    const row = rowOf(/スーパー/)
    expect(await row.findByText('取り込み済みのため対象外です')).toBeInTheDocument()
    expect(row.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(row.queryByLabelText('スーパーのコメント')).not.toBeInTheDocument()
    expect(row.getByText('重複・除外')).toBeInTheDocument()

    fireEvent.click(row.getByRole('button', { name: '取り込む' }))

    expect(rowOf(/スーパー/).getByLabelText('スーパーのコメント')).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByText('要確認')).toBeInTheDocument()
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
    const bulk = within(screen.getByRole('group', { name: '選択した明細への一括設定' }))
    expect(bulk.getByText('2件に一括設定')).toBeInTheDocument()
    fireEvent.change(bulk.getByLabelText('精算バッチを一括設定'), { target: { value: '1' } })

    expect(bulk.getByText('1件に設定しました(1件は対象外)')).toBeInTheDocument()
    expect(rowOf(/ランチ/).getByLabelText('ランチの精算バッチ')).toHaveValue('1')

    pick(bulk, '一括のプロジェクト', '沖縄旅行')
    expect(bulk.getByText('2件に設定しました')).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByRole('button', { name: new RegExp(`^プロジェクト: ${trip.name}`) })).toBeInTheDocument()
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

    expect(rowOf(/スーパー/).queryByLabelText('スーパーの精算バッチ')).not.toBeInTheDocument()
    expect(rowOf(/ランチ/).getByLabelText('ランチの精算バッチ')).toBeInTheDocument()
  })

  it('確定すると仕訳が作られ、同じ画面で続けて次のCSVを取り込める', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.change(rowOf(/スーパー/).getByLabelText('スーパーのコメント'), { target: { value: 'まとめ買い' } })

    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

    expect(await screen.findByText(/確定しました。続けて次のCSVを取り込めます。/)).toBeInTheDocument()
    const created = userEntries()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ comment: 'まとめ買い', sourceType: 'external_import' })
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()

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
    expect(screen.queryByLabelText('誰の明細か(必須)')).not.toBeInTheDocument()
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「花子の口座」に確定$/ }))

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

    const confirm = screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ })
    expect(screen.getByLabelText('誰の明細か(必須)')).toHaveValue('')
    expect(confirm).toBeDisabled()
    expect(screen.getByText('誰の明細かを選ぶと確定できます')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('誰の明細か(必須)'), { target: { value: String(hanako.id) } })
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

    const owner = screen.getByLabelText('誰の明細か(必須)')
    expect(within(owner).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ })).toBeDisabled()
    expect(screen.getByText('誰の明細かを選ぶと確定できます')).toBeInTheDocument()
    expect(userEntries()).toHaveLength(0)
  })

  it('取込先の科目を変えると、選んだ「誰の明細か」は選び直しになる(計画Issue #193)', async () => {
    const other = accounts.create({ category: 'asset', name: '別の預金', isReconcilable: true })
    makeMapping({ accountIds: [bank.id, other.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    expect(screen.getByLabelText('誰の明細か(必須)')).toHaveValue(String(memberId))

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: String(other.id) } })

    await screen.findByText(/statement\.csv を読み込み済み/)
    expect(screen.getByLabelText('誰の明細か(必須)')).toHaveValue('')
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

    it('確定できない行(相手科目が未選択)が残るときは、「保存して移動」でも移動しない', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,カフェ,-500,96500
`)
      pick(rowOf(/スーパー/), '相手科目', '食費')

      leave()
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

      expect(await screen.findByText(/相手科目が未選択です/)).toBeInTheDocument()
      expect(screen.getByTestId('where')).toHaveTextContent('/master/here')
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

  it('相手科目が未選択の行は確定に失敗し、理由を表示する', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    fireEvent.click(await screen.findByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

    expect(await screen.findByText(/相手科目が未選択です/)).toBeInTheDocument()
    expect(userEntries()).toHaveLength(0)
  })

  it('確定版の可能性がある行は、「これは確定版です」を選ぶと既存の仕訳を置き換える', async () => {
    makeMapping()
    const manual = entries.create({
      householdMemberId: memberId,
      entryDate: '2026-10-05',
      sourceType: 'manual',
      lines: [
        { householdMemberId: memberId, accountId: food.id, side: 'debit', amount: 3000 },
        { householdMemberId: memberId, accountId: bank.id, side: 'credit', amount: 3000 },
      ],
    })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(await screen.findByLabelText('これは確定版です'))

    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

    await screen.findByText(/確定しました/)
    // 削除した仕訳のIDは新しい仕訳に再利用されうるので、手入力の仕訳が残っていないことを起源で確認する
    expect(manual.sourceType).toBe('manual')
    expect(userEntries().map((e) => e.sourceType)).toEqual(['external_import'])
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

  it('取引先を選んだ行は、取引先の設定を開かなくても確定時に摘要が正規化されてキーワードに登録され、件数を伝える', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'スーパーA' })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
    pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
    pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')
    // 行の下に割り込む設定行(キーワード登録のチェックなど)は無い
    expect(screen.queryByLabelText('パターン登録')).not.toBeInTheDocument()

    fireEvent.click(confirmButton(1))

    expect(await screen.findByText(/キーワードを1件登録しました/)).toBeInTheDocument()
    // 空白を除いた形で保存するので、次回以降の取引先の推定(正規化した摘要への部分一致)に当たる
    expect(keywordRules.findMatching('スーパー新宿店').map((p) => p.counterpartyId)).toEqual([cp.id])
  })

  describe('取引先の設定(計画Issue #207)', () => {
    /** 取引先を手で選んだ行(取引先の設定のリンクが出る行)を作る */
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

    it('「取引先の設定」は推定と違う取引先を選んだ行にだけ出て、開くとタイトル・登録済みと新規のキーワードが並ぶ(確定時に登録の注記は出ない)', async () => {
      makeMapping()
      const cp = counterparties.create({ name: 'スーパーA' })
      keywordRules.create({ pattern: 'ローソン', counterpartyId: cp.id })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n2026/10/06,ローソン 渋谷,-500,96500\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')

      // 「ローソン」のキーワードで自動マッチした行には、設定のリンクを出さない
      expect(await rowOf(/ローソン 渋谷/).findByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
      expect(rowOf(/ローソン 渋谷/).queryByRole('button', { name: /の取引先の設定$/ })).not.toBeInTheDocument()

      await openCounterpartySettings('スーパー 新宿店')

      expect(screen.getByRole('dialog', { name: '取引先の設定: スーパーA' })).toBeInTheDocument()
      // 「キーワードを追加」で足したキーワードは入力を終えた時点で保存されるため、「確定時に登録」の注記は出さない(計画Issue #218)
      expect(settings().queryByText(/この行を確定したときに登録されます/)).not.toBeInTheDocument()
      expect(settings().getByText('取引先のキーワード')).toBeInTheDocument()
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ローソン'))
      expect(settings().getByLabelText('キーワード2')).toHaveValue('スーパー 新宿店')
      expect(settings().getByText('登録済み')).toBeInTheDocument()
      expect(settings().getByText('新規')).toBeInTheDocument()
      // 各キーワードを含む行の数(この明細で)
      expect(settings().getAllByText('1行')).toHaveLength(2)
    })

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
      fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'スーパー' } })

      fireEvent.keyDown(settings().getByLabelText('キーワード2'), { key: 'Enter' })
      fireEvent.blur(settings().getByLabelText('キーワード2'))

      await waitFor(() => expect(patternsOf(cp.id)).toEqual(['スーパー']))
      expect(screen.queryByText('保存できませんでした。もう一度お試しください。')).not.toBeInTheDocument()
    })

    it('登録済みのキーワードの削除は、押した時点でDBから消える', async () => {
      const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
      await openCounterpartySettings('スーパー 新宿店')
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

      fireEvent.click(settings().getByRole('button', { name: 'キーワード1を削除' }))

      await waitFor(() => expect(patternsOf(cp.id)).toEqual([]))
      expect(settings().queryByDisplayValue('マルエツ')).not.toBeInTheDocument()
    })

    it('「キーワードを追加」で足したキーワードは、入力を終えたときに(正規化して)保存され、「登録済み」になる', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'スーパー 新宿' } })
      expect(patternsOf(cp.id)).toEqual([])
      fireEvent.blur(settings().getByLabelText('キーワード2'))

      await waitFor(() => expect(patternsOf(cp.id)).toEqual(['スーパー新宿']))
      expect(settings().getByText('登録済み')).toBeInTheDocument()
    })

    it('追加して何も入力しなかった空欄は、入力を終えると何も保存せずに取り除かれる', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.blur(settings().getByLabelText('キーワード2'))

      expect(settings().queryByLabelText('キーワード2')).not.toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual([])
    })

    it('摘要の提案(「新規」)は、開いただけでは保存されず、その行を確定したときに登録される', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      expect(settings().getByLabelText('キーワード1')).toHaveValue('スーパー 新宿店')
      expect(patternsOf(cp.id)).toEqual([])

      fireEvent.click(confirmButton(1))

      expect(await screen.findByText(/キーワードを1件登録しました/)).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual(['スーパー新宿店'])
    })

    it('摘要の提案を削除すると、確定しても登録されず、消した提案は復活しない', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.click(settings().getByRole('button', { name: 'キーワード1を削除' }))
      expect(settings().queryByLabelText('キーワード1')).not.toBeInTheDocument()
      fireEvent.click(confirmButton(1))

      await waitFor(() => expect(userEntries()).toHaveLength(1))
      expect(patternsOf(cp.id)).toEqual([])
    })

    it('キーワードの科目は、選んだ時点でそのキーワード(ルール)に保存される(計画Issue #219)', async () => {
      const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
      await openCounterpartySettings('スーパー 新宿店')
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))
      expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBeNull()

      fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(food.id) } })

      await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(food.id))
      expect(settings().getByLabelText('キーワード1の科目')).toHaveValue(String(food.id))
    })

    it('「取引先の設定」に、相手科目の初期値の欄は無く、キーワードごとに科目を選ぶ(選択肢は費用・収益の科目だけ。計画Issue #219)', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      expect(settings().queryByText('相手科目の初期値')).not.toBeInTheDocument()
      const select = settings().getByLabelText('キーワード1の科目')
      expect(within(select).getByRole('option', { name: '食費' })).toBeInTheDocument()
      expect(within(select).queryByRole('option', { name: '普通預金' })).not.toBeInTheDocument()
    })

    it('摘要の提案(新規)の科目は、この行の相手科目が入り、ここでは変えられない', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      expect(settings().getByLabelText('キーワード1の科目')).toHaveValue(String(food.id))
      expect(settings().getByLabelText('キーワード1の科目')).toBeDisabled()
    })

    it('摘要の提案は、確定時に、取引先と行の相手科目を1つのルールとして登録する(計画Issue #219)', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')

      fireEvent.click(confirmButton(1))

      await waitFor(() => expect(userEntries()).toHaveLength(1))
      expect(keywordRules.findByCounterparty(cp.id).map((r) => [r.pattern, r.accountId])).toEqual([['スーパー新宿店', food.id]])
    })

    it('新規のキーワードが摘要に含まれない文字列だと、その旨を出して保存しない', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

      fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'ローソン' } })
      fireEvent.blur(settings().getByLabelText('キーワード2'))

      expect(settings().getByText('この文字列は摘要に含まれないため登録できません')).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual([])
    })

    it('ほかのキーワード(ここでは摘要の提案)と、正規化すると同じになる文字列は、その旨を出して保存しない', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

      fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'ｽｰﾊﾟｰ新宿店' } })
      fireEvent.blur(settings().getByLabelText('キーワード2'))

      expect(settings().getByText('同じキーワードがあります')).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual([])
    })

    it('登録済みのキーワードを空にして入力を終えると、その旨を出して保存しない(消すときは削除を使う)', async () => {
      const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
      await openCounterpartySettings('スーパー 新宿店')
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: '  ' } })
      fireEvent.blur(settings().getByLabelText('キーワード1'))

      expect(settings().getByText('キーワードを入力してください。消す場合は削除を押してください')).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual(['マルエツ'])
    })

    it('「ほかの行にも適用」は、一覧のキーワードを含み取引先が未設定の行にだけ取引先を設定して件数を示し、手で選んだ行は変えず、DBには書かない', async () => {
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
      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ニチケイ' } })

      fireEvent.click(settings().getByRole('button', { name: 'ほかの行にも適用' }))

      expect(settings().getByText('1行に適用しました')).toBeInTheDocument()
      expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^取引先: スーパーA/ })).toBeInTheDocument()
      expect(rowOf(/別の店 1月/).queryByRole('button', { name: /^取引先: スーパーA/ })).not.toBeInTheDocument()
      expect(rowOf(/ニチケイ 4月/).getByRole('button', { name: /^取引先: スーパーB/ })).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual([])
      expect(patternsOf(other.id)).toEqual([])
    })

    it('適用した行は、確定時に摘要が重ねてキーワード登録されず、取引先の設定のリンクも出ない', async () => {
      makeMapping()
      const cp = counterparties.create({ name: 'スーパーA' })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n`)
      pick(rowOf(/ニチケイ 3月/), '相手科目', '食費')
      pick(rowOf(/ニチケイ 3月/), '取引先', 'スーパーA')
      pick(rowOf(/ニチケイ 2月/), '相手科目', '食費')
      await openCounterpartySettings('ニチケイ 3月')
      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ニチケイ' } })
      fireEvent.click(settings().getByRole('button', { name: 'ほかの行にも適用' }))
      expect(rowOf(/ニチケイ 2月/).queryByRole('button', { name: /の取引先の設定$/ })).not.toBeInTheDocument()

      fireEvent.click(confirmButton(2))

      expect(await screen.findByText(/キーワードを1件登録しました/)).toBeInTheDocument()
      expect(patternsOf(cp.id)).toEqual(['ニチケイ'])
    })

    it('キーワードの科目を選ぶと、そのキーワードに一致し取引先が同じで科目を手で選んでいない行にだけ、その時点で入る(「ほかの行にも適用」を押す必要はない。計画Issue #218・#219)', async () => {
      makeMapping()
      const supplies = accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
      accounts.create({ category: 'expense', name: '雑費', isReconcilable: null })
      const cp = counterparties.create({ name: 'セブン' })
      keywordRules.create({ pattern: 'セブン', counterpartyId: cp.id, accountId: food.id })
      renderScreen()
      await chooseCsv(
        `${HEADER}2026/10/05,セブン 1,-100,97000\n2026/10/06,セブン 2,-100,96000\n2026/10/07,セブン 3,-100,95000\n2026/10/08,ローソン 4,-100,94000\n`,
      )
      // 3行目は科目を手で選んでいる。4行目は利用者が取引先を手で選んだ(設定のリンクが出る行)
      pick(rowOf(/セブン 3/), '相手科目', '雑費')
      pick(rowOf(/ローソン 4/), '取引先', 'セブン')
      await openCounterpartySettings('ローソン 4')
      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('セブン'))

      fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(supplies.id) } })
      await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

      // セブン1・セブン2(キーワードに一致し、取引先が同じで科目は未編集)に入る。キーワードに一致しないローソン4には入らない
      await waitFor(() => expect(rowOf(/セブン 1/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument())
      expect(rowOf(/セブン 2/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument()
      expect(rowOf(/セブン 3/).getByRole('button', { name: /^相手科目: 雑費/ })).toBeInTheDocument()
      expect(rowOf(/ローソン 4/).queryByRole('button', { name: /^相手科目: 日用品費/ })).not.toBeInTheDocument()
    })

    it('適用できる行が無いときは、その旨を示す', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.click(settings().getByRole('button', { name: 'ほかの行にも適用' }))

      expect(settings().getByText('適用できる行はありませんでした')).toBeInTheDocument()
    })

    it('「閉じる」でポップアップが閉じ、もう一度開くと保存済みのキーワードが見える', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: '新宿' } })
      fireEvent.blur(settings().getByLabelText('キーワード2'))
      await waitFor(() => expect(settings().getByText('登録済み')).toBeInTheDocument())

      fireEvent.click(settings().getByRole('button', { name: '閉じる' }))
      expect(screen.queryByRole('dialog', { name: /^取引先の設定: / })).not.toBeInTheDocument()
      await openCounterpartySettings('スーパー 新宿店')

      await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('新宿'))
    })

    describe('保存に失敗したとき', () => {
      /** 指定したメソッドだけ失敗するキーワードルールのRepository(ほかは本物のまま) */
      const failing = (method: 'update' | 'create' | 'delete') =>
        Object.assign(Object.create(keywordRules), {
          [method]: () => {
            throw new Error('保存の失敗')
          },
        }) as typeof keywordRules
      const SAVE_ERROR = '保存できませんでした。もう一度お試しください。'

      it('登録済みのキーワードの編集を保存できなかったら、ポップアップ内にエラーを出し、入力した内容は残す', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }), failing('update'))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'マルエツ新宿' } })
        fireEvent.blur(settings().getByLabelText('キーワード1'))

        expect(await settings().findByText(SAVE_ERROR)).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ新宿')
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])
      })

      it('新規のキーワードを保存できなかったら、ポップアップ内にエラーを出し、「新規」のまま入力を残す', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', () => undefined, failing('create'))
        await openCounterpartySettings('スーパー 新宿店')
        fireEvent.click(settings().getByRole('button', { name: 'キーワードを追加' }))

        fireEvent.change(settings().getByLabelText('キーワード2'), { target: { value: 'スーパー' } })
        fireEvent.blur(settings().getByLabelText('キーワード2'))

        expect(await settings().findByText(SAVE_ERROR)).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード2')).toHaveValue('スーパー')
        expect(settings().queryByText('登録済み')).not.toBeInTheDocument()
        expect(patternsOf(cp.id)).toEqual([])
      })

      it('登録済みのキーワードの削除を保存できなかったら、ポップアップ内にエラーを出し、一覧からは消さない', async () => {
        const cp = await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }), failing('delete'))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.click(settings().getByRole('button', { name: 'キーワード1を削除' }))

        expect(await settings().findByText(SAVE_ERROR)).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ')
        expect(patternsOf(cp.id)).toEqual(['マルエツ'])
      })

      it('キーワードの科目を保存できなかったら、ポップアップ内にエラーを出し、科目は変わらない', async () => {
        const cp = await setupPickedRow(
          'スーパー 新宿店',
          (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }),
          failing('update'),
        )
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))

        fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(food.id) } })

        expect(await settings().findByText(SAVE_ERROR)).toBeInTheDocument()
        expect(settings().getByLabelText('キーワード1の科目')).toHaveValue('')
        expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBeNull()
      })
    })

    it('Escキーでポップアップが閉じる', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.keyDown(screen.getByRole('dialog', { name: /^取引先の設定: / }), { key: 'Escape' })

      expect(screen.queryByRole('dialog', { name: /^取引先の設定: / })).not.toBeInTheDocument()
    })

    it('ポップアップの外側を押すと閉じるが、中の操作(科目の選択など)では閉じない', async () => {
      await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')

      fireEvent.pointerDown(settings().getByLabelText('キーワード1'))
      expect(screen.getByRole('dialog', { name: /^取引先の設定: / })).toBeInTheDocument()

      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('dialog', { name: /^取引先の設定: / })).not.toBeInTheDocument()
    })

    it('開いたまま行の取引先を別の取引先に変えても、「取引先の設定」を1回押せば新しい取引先の設定が開く', async () => {
      makeMapping()
      counterparties.create({ name: 'スーパーA' })
      counterparties.create({ name: 'スーパーB' })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')
      await openCounterpartySettings('スーパー 新宿店')

      pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーB')
      fireEvent.click(rowOf(/スーパー 新宿店/).getByRole('button', { name: 'スーパー 新宿店の取引先の設定' }))

      expect(await screen.findByRole('dialog', { name: '取引先の設定: スーパーB' })).toBeInTheDocument()
    })

    it('摘要の提案を不正な文字列に直したまま確定しようとすると、確定せずにその旨を出し、直す(または削除する)と確定できる', async () => {
      const cp = await setupPickedRow('スーパー 新宿店')
      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.change(settings().getByLabelText('キーワード1'), { target: { value: 'ローソン' } })
      fireEvent.click(settings().getByRole('button', { name: '閉じる' }))

      fireEvent.click(confirmButton(1))

      expect(await screen.findByText('摘要から入るキーワードに問題があります。「取引先の設定」で直すか、削除してください。')).toBeInTheDocument()
      expect(userEntries()).toHaveLength(0)

      await openCounterpartySettings('スーパー 新宿店')
      fireEvent.click(settings().getByRole('button', { name: 'キーワード1を削除' }))
      fireEvent.click(confirmButton(1))

      await waitFor(() => expect(userEntries()).toHaveLength(1))
      expect(patternsOf(cp.id)).toEqual([])
    })

    describe('不具合の再現(計画Issue #218)', () => {
      /**
       * 「ニチケイ」を含む行(キーワードに一致して取引先・科目が入る)が複数あり、最後の「別の店」の行で取引先を手で選んで
       * 「取引先の設定」を開く。キーワードに一致した行には設定のリンクが出ないため(推定どおりの取引先のため)、手で選んだ行から開く
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
        const { supplies, cp } = await setupFollowCase(
          '2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n',
        )
        expect(await rowOf(/ニチケイ 2月/).findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
        pick(rowOf(/別の店/), '相手科目', '食費')
        pick(rowOf(/別の店/), '取引先', 'スーパーA')
        await openCounterpartySettings('別の店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ニチケイ'))

        fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(supplies.id) } })
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

        await waitFor(() => expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument())
        expect(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument()
        expect(settings().getByText('2行の相手科目をキーワードの科目にしました')).toBeInTheDocument()
      })

      it('科目を手で選び直した行は、キーワードの科目を変えても追従させない。直前の適用の結果のメッセージは残さない', async () => {
        const { supplies, cp } = await setupFollowCase(
          '2026/10/05,ニチケイ 3月,-1000,97000\n2026/10/06,ニチケイ 2月,-1000,96000\n',
        )
        expect(await rowOf(/ニチケイ 2月/).findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
        pick(rowOf(/ニチケイ 2月/), '相手科目', '雑費')
        pick(rowOf(/別の店/), '相手科目', '食費')
        pick(rowOf(/別の店/), '取引先', 'スーパーA')
        await openCounterpartySettings('別の店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('ニチケイ'))
        fireEvent.click(settings().getByRole('button', { name: 'ほかの行にも適用' }))
        expect(settings().getByText('適用できる行はありませんでした')).toBeInTheDocument()

        fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(supplies.id) } })
        await waitFor(() => expect(keywordRules.findByCounterparty(cp.id)[0].accountId).toBe(supplies.id))

        await waitFor(() => expect(rowOf(/ニチケイ 3月/).getByRole('button', { name: /^相手科目: 日用品費/ })).toBeInTheDocument())
        expect(rowOf(/ニチケイ 2月/).getByRole('button', { name: /^相手科目: 雑費/ })).toBeInTheDocument()
        expect(settings().getByText('1行の相手科目をキーワードの科目にしました')).toBeInTheDocument()
        expect(settings().queryByText('適用できる行はありませんでした')).not.toBeInTheDocument()
      })

      it('キーワードの科目を変えても反映する行が無いときは、直前の適用の結果のメッセージを消し、何も出さない', async () => {
        // 科目は画面を開く前に作っておく(開いたあとに作った科目は一覧に出ない)
        const supplies = accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
        await setupPickedRow('スーパー 新宿店', (id) => keywordRules.create({ pattern: 'マルエツ', counterpartyId: id }))
        await openCounterpartySettings('スーパー 新宿店')
        await waitFor(() => expect(settings().getByLabelText('キーワード1')).toHaveValue('マルエツ'))
        fireEvent.click(settings().getByRole('button', { name: 'ほかの行にも適用' }))
        expect(settings().getByText('適用できる行はありませんでした')).toBeInTheDocument()

        fireEvent.change(settings().getByLabelText('キーワード1の科目'), { target: { value: String(supplies.id) } })

        await waitFor(() => expect(settings().queryByText('適用できる行はありませんでした')).not.toBeInTheDocument())
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

    it('取込先の「+ 科目を新規追加」では、区分の既定は従来どおり「資産」のままである', async () => {
      makeMapping({ accountIds: [] })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)
      await screen.findByLabelText('科目')

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
        ['スーパー', null],
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

    it('行の摘要に含まれないキーワードがあると、その旨を出して追加せず、取引先も作らない', async () => {
      makeMapping()
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)

      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード1'), { target: { value: 'ローソン' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      expect(dialog('取引先を追加').getByText('この文字列は摘要に含まれないため登録できません')).toBeInTheDocument()
      expect(counterparties.findAll()).toEqual([])
    })

    it('キーワードごとに別の科目を選んで追加でき、キーワードと科目のセットとして保存される(新しく足したキーワードの科目は、最初は指定なし)', async () => {
      makeMapping()
      accounts.create({ category: 'expense', name: '日用品費', isReconcilable: null })
      renderScreen()
      await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
      pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
      openCounterpartyDialog(/スーパー 新宿店/)
      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: 'キーワードを追加' }))
      fireEvent.change(dialog('取引先を追加').getByLabelText('キーワード2'), { target: { value: '新宿' } })
      expect(dialog('取引先を追加').getByRole('button', { name: /^キーワード2の科目: 指定なし/ })).toBeInTheDocument()

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
        await screen.findByText('取引先は追加しましたが、保存できなかったキーワードがあります。「取引先の設定」から追加してください。'),
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
    const linked = makeMapping({ label: '普通預金用' })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    const select = await screen.findByLabelText('マッピング定義')
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['選択してください', '汎用の定義', '普通預金用'])
    fireEvent.change(select, { target: { value: String(linked.id) } })
    await screen.findByText(/statement\.csv を読み込み済み/)
    expect(screen.getByLabelText('科目')).toHaveValue(String(bank.id))
  })

  it('定義に紐づく科目が複数あるときは先頭が初期値で、別の科目に変更して取り込める', async () => {
    const card = accounts.create({ category: 'liability', name: '楽天VISA', isReconcilable: false, hasExternalStatement: true })
    makeMapping({ accountIds: [bank.id, card.id] })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    const target = screen.getByLabelText('科目')
    expect(target).toHaveValue(String(bank.id))
    fireEvent.change(target, { target: { value: String(card.id) } })
    await screen.findByRole('button', { name: /^1 件を「楽天VISA」に確定$/ })
    fireEvent.change(screen.getByLabelText('誰の明細か(必須)'), { target: { value: String(memberId) } })
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「楽天VISA」に確定$/ }))

    await screen.findByText(/確定しました/)
    const accountIds = userEntries()[0].lines.map((l) => l.accountId)
    expect(accountIds).toContain(card.id)
    expect(accountIds).not.toContain(bank.id)
  })

  it('紐づく科目が無い定義では、取込先を選ぶまで一覧を出さず、選んで確定すると紐づけを追加する', async () => {
    const only = makeMapping({ accountIds: [] })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    const target = await screen.findByLabelText('科目')
    expect(target).toHaveValue('')
    expect(screen.getByText('科目を選ぶと、明細の一覧を表示します。')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '明細の一覧' })).not.toBeInTheDocument()

    fireEvent.change(target, { target: { value: String(bank.id) } })
    await screen.findByText(/statement\.csv を読み込み済み/)
    fireEvent.change(screen.getByLabelText('誰の明細か(必須)'), { target: { value: String(memberId) } })
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

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
    await screen.findByLabelText('科目')

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
    const target = await screen.findByLabelText('科目')
    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
    expect(mappings.findAll()[0]).toMatchObject({ label: '新しい銀行', formatGroupId: 'new-bank', dateColumn: '日付' })
    fireEvent.change(target, { target: { value: String(bank.id) } })
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
    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(1件)' }))
    expect(skipped.getByText(/3行目/)).toBeInTheDocument()
    expect(skipped.getByText(/為替レート 1ドル=150円/)).toBeInTheDocument()
    expect(skipped.getByText(/日付を読み取れません/)).toBeInTheDocument()

    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)
    expect(userEntries()).toHaveLength(1)
  })

  it('読み取れない行の方が多いときは、取り込めるが、マッピングが合っているか確認する警告を出す(計画Issue #151)', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n,補足1,,\n,補足2,,\n`)

    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(2件)' }))
    expect(skipped.getByText(/読み取れない行の方が多いです/)).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByText('2026/10/05')).toBeInTheDocument()
  })

  it('読み取れない行が少ないときは、警告は出さない', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n,補足,,\n`)

    const skipped = within(await screen.findByRole('region', { name: '取り込まない行(1件)' }))
    expect(skipped.queryByText(/読み取れない行の方が多いです/)).not.toBeInTheDocument()
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
    await screen.findByLabelText('科目')
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

    await screen.findByLabelText('科目')
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
})
