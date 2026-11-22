// @vitest-environment jsdom
/**
 * StatementImportScreen の一時保存と再開(計画Issue #231 フェーズ3)のコンポーネントテスト。
 * 「一時保存」で、CSVの生データ・マッピング定義・取込先・取り込むファイルのチェック・誰の明細か・初期値から変えた行の入力を
 * 保存すること(取込先ごとに1つ、同じ取込先に保存し直すと上書き。再開した一時保存への保存は確認なし、別の取込からは上書きの確認)、
 * 保存したあとは未保存の警告が出ないこと、開始状態の一覧から再開するとCSVを選び直さずに続きから始められること(保存した入力が
 * キーワードルールの推定より優先され、保存後に確定した行は重複として自動で除外され、削除された参照先の入力は戻さず通知する)、
 * 破棄・全行の確定で一時保存が消えること(部分確定では残る)、保存時の定義で読めないときの案内と定義の作り直し、
 * 未保存の警告の「保存して移動」(入力済みを確定し、残りを一時保存)と「一時保存して移動」(何も確定せず保存)を確認する。
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
import { StatementImportScreen } from './StatementImportScreen'
import { chooseMember, expectMember } from '../master/memberSelectTestHelpers'
import { expectTargetAccount } from './targetAccountTestHelpers'

let db: Database
let entries: SqlJsJournalEntryRepository
let drafts: SqlJsStatementImportDraftRepository
let mappings: SqlJsImportMappingDefinitionRepository
let projects: SqlJsProjectRepository
let memberId: number
let bank: ReturnType<SqlJsAccountRepository['create']>
let card: ReturnType<SqlJsAccountRepository['create']>

beforeEach(async () => {
  localStorage.clear()
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  const accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  drafts = new SqlJsStatementImportDraftRepository(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
  projects = new SqlJsProjectRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  bank = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  card = accounts.create({ category: 'liability', name: '楽天VISA', isReconcilable: false, hasExternalStatement: true })
  accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
  makeMapping()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function makeMapping(overrides: Partial<Parameters<typeof mappings.create>[0]> = {}) {
  return mappings.create({
    formatGroupId: 'my-bank',
    label: 'マイ銀行',
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    accountIds: [bank.id],
    ...overrides,
  })
}

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <StatementImportScreen
          accountRepository={new SqlJsAccountRepository(db)}
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
          statementImportDraftRepository={drafts}
          onEditMappings={vi.fn()}
        />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

/** 画面を閉じて開き直す(DBは残る)。別の日に取込画面を開いた場面 */
function restartScreen() {
  cleanup()
  renderScreen()
}

const HEADER = '日付,摘要,金額,残高\n'
const CSV3 = `${HEADER}2026/10/05,スーパー,-3000,97000
2026/10/06,ランチ,-800,96200
2026/10/07,家賃,-50000,46200
`
const SEP = { name: 'sep.csv', body: `${HEADER}2025/09/05,Spotify,-980,99020\n` }
const OCT = { name: 'oct.csv', body: `${HEADER}2025/10/03,コンビニ,-420,98600\n2025/10/26,Amazon,-2980,95620\n` }

/** CSVをまとめて選ぶ。「誰の明細か」も選ぶ(科目に名義が無いため) */
async function chooseCsvs(files: Array<{ name: string; body: string }>, waitFor: RegExp = /を読み込み済み/) {
  fireEvent.change(await screen.findByLabelText('CSVを選択'), {
    target: { files: files.map((f) => new File([f.body], f.name, { type: 'text/csv' })) },
  })
  await screen.findByText(waitFor)
  if (screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })) chooseMember('誰の明細か(必須)', '自分')
}
const chooseCsv = (content: string) => chooseCsvs([{ name: 'statement.csv', body: content }], /statement\.csv を読み込み済み/)

const rowOf = (text: RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}
const userEntries = () => entries.findAll().filter((e) => e.sourceType !== 'auto_balance_adjustment')
const saveButtons = () => screen.getAllByRole('button', { name: '一時保存' })
const draftList = async () => within(await screen.findByRole('region', { name: '一時保存した取込' }))
const resume = async (accountName = '普通預金') => {
  fireEvent.click(await screen.findByRole('button', { name: `${accountName}の一時保存を再開` }))
  await screen.findByText(/から再開しました/)
}
const confirmButton = (ready: number, total: number) =>
  screen.getByRole('button', { name: new RegExp(`^${ready} / ${total} 件を「普通預金」に確定$`) })

describe('一時保存', () => {
  it('一覧が出ているときだけ「一時保存」を、画面上部のボタン列と確定ボタンの横の2か所に出す', async () => {
    renderScreen()
    await screen.findByLabelText('CSVを選択')
    expect(screen.queryByRole('button', { name: '一時保存' })).not.toBeInTheDocument()

    await chooseCsv(CSV3)

    expect(saveButtons()).toHaveLength(2)
  })

  it('押すと、CSVの生データ・定義・取込先・誰の明細か・件数を保存し、保存した旨を出して、画面はそのまま続けられる(確定はしない)', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    fireEvent.click(saveButtons()[0])

    expect(await screen.findByText(/一時保存しました/)).toBeInTheDocument()
    const [summary] = drafts.findSummaries()
    expect(summary).toMatchObject({ targetAccountId: bank.id, fileNames: ['statement.csv'], totalRows: 3, filledRows: 1 })
    const draft = drafts.findById(summary.id)!
    expect(draft).toMatchObject({ ownerMemberId: memberId })
    expect(new TextDecoder().decode(draft.files[0].bytes)).toBe(CSV3)
    expect(userEntries()).toHaveLength(0)
    expect(screen.getAllByRole('row', { name: /スーパー/ }).length).toBeGreaterThan(0)
  })

  it('保存する行の入力は、初期値から変えた行だけ(外部取引IDごと)である', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.change(screen.getByLabelText('家賃のコメント'), { target: { value: '12月分' } })

    fireEvent.click(saveButtons()[1])

    await screen.findByText(/一時保存しました/)
    const inputs = Object.values(drafts.findById(drafts.findSummaries()[0].id)!.rowInputs)
    expect(inputs).toHaveLength(2)
    expect(inputs.map((i) => i.comment).sort()).toEqual(['', '12月分'])
  })

  it('取り込むファイルのチェックと、チェックを外したファイルの行の入力も保存する', async () => {
    renderScreen()
    await chooseCsvs([SEP, OCT], /2ファイルを読み込み済み/)
    pick(rowOf(/Spotify/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('checkbox', { name: 'sep.csvを取り込む' }))
    await screen.findByText(/oct\.csv を読み込み済み/)

    fireEvent.click(saveButtons()[0])

    await screen.findByText(/一時保存しました/)
    const draft = drafts.findById(drafts.findSummaries()[0].id)!
    // CSVは選んだ順(sep.csv、oct.csv)に保存し、取り込むファイルのチェックも覚える
    expect(draft.files.map((f) => [f.fileName, f.isChecked])).toEqual([
      ['sep.csv', false],
      ['oct.csv', true],
    ])
    expect(Object.keys(draft.rowInputs)).toHaveLength(1)
  })

  it('保存したあとは、入力が保存済みなので、他の画面へ移るときに未保存の警告を出さない。そのあとに入力すると出る', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)

    fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/other')
  })

  it('保存したあとに入力を変えると、未保存の警告が出る', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)

    pick(rowOf(/ランチ/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))

    expect(screen.getByRole('dialog', { name: '未保存の変更があります' })).toBeInTheDocument()
  })

  it('再開した一時保存(同じ取込先)へ保存し直すときは、確認なしで上書きし、一時保存は1つのまま', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()
    await resume()
    pick(rowOf(/ランチ/), '相手科目', '食費')

    fireEvent.click(saveButtons()[0])

    await screen.findByText(/一時保存しました/)
    expect(screen.queryByRole('dialog', { name: '一時保存を上書きしますか' })).not.toBeInTheDocument()
    expect(drafts.findSummaries()).toHaveLength(1)
    expect(Object.keys(drafts.findById(drafts.findSummaries()[0].id)!.rowInputs)).toHaveLength(2)
  })

  it('同じ取込先の一時保存があるときに、別の取込から保存しようとすると上書きの確認を出し、キャンセルすると保存しない', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    const savedId = drafts.findSummaries()[0].id
    restartScreen()
    await chooseCsv(`${HEADER}2026/11/01,カフェ,-500,45700\n`)
    pick(rowOf(/カフェ/), '相手科目', '食費')

    fireEvent.click(saveButtons()[0])
    const dialog = await screen.findByRole('dialog', { name: '一時保存を上書きしますか' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    expect(drafts.findById(savedId)!.files.map((f) => new TextDecoder().decode(f.bytes))).toEqual([CSV3])
  })

  it('上書きの確認で「上書きする」を選ぶと、別の取込の内容に置き換わる', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()
    await chooseCsv(`${HEADER}2026/11/01,カフェ,-500,45700\n`)
    pick(rowOf(/カフェ/), '相手科目', '食費')

    fireEvent.click(saveButtons()[0])
    fireEvent.click(within(await screen.findByRole('dialog', { name: '一時保存を上書きしますか' })).getByRole('button', { name: '上書きする' }))

    await screen.findByText(/一時保存しました/)
    expect(drafts.findSummaries()).toHaveLength(1)
    expect(drafts.findSummaries()[0].totalRows).toBe(1)
  })
})

describe('開始状態の一時保存の一覧', () => {
  it('一時保存が無いときは出さない', async () => {
    renderScreen()
    await screen.findByLabelText('CSVを選択')

    expect(screen.queryByRole('region', { name: '一時保存した取込' })).not.toBeInTheDocument()
  })

  it('取込先・CSVのファイル名・「入力済み / 全件」・保存日時・「再開」「破棄」を出す', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()

    const list = await draftList()
    await list.findByText('普通預金')
    expect(list.getByText('statement.csv')).toBeInTheDocument()
    expect(list.getByText('1 / 3 件')).toBeInTheDocument()
    expect(list.getByText(/^\d{4}\/\d\d\/\d\d \d\d:\d\d$/)).toBeInTheDocument()
    expect(list.getByRole('button', { name: '普通預金の一時保存を再開' })).toBeInTheDocument()
    expect(list.getByRole('button', { name: '普通預金の一時保存を破棄' })).toBeInTheDocument()
  })

  it('CSVを選んで一覧を出したあとは、開始状態の一覧は出さない', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)

    expect(screen.queryByRole('region', { name: '一時保存した取込' })).not.toBeInTheDocument()
  })
})

describe('再開', () => {
  async function saveSuperDraft() {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.change(screen.getByLabelText('スーパーのコメント'), { target: { value: '週末の買い出し' } })
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()
  }

  it('CSVを選び直さずに一覧が開き、取込先・保存した入力(相手科目・コメント)が戻り、再開した旨を通知する', async () => {
    await saveSuperDraft()

    await resume()

    expectTargetAccount(bank.name)
    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    expect(screen.getByLabelText('スーパーのコメント')).toHaveValue('週末の買い出し')
    expect(screen.getByText(/重複・似た取引・残高の照合は、いまの帳簿で計算し直しています/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '一時保存した取込' })).not.toBeInTheDocument()
  })

  it('誰の明細かも戻り、そのまま確定できる(確定ボタンの件数にも、戻した入力が数えられる)', async () => {
    await saveSuperDraft()

    await resume()

    expectMember('誰の明細か(必須)', '自分')
    expect(confirmButton(1, 3)).toBeEnabled()
  })

  it('保存した入力は、キーワードルールによる推定より優先される(推定で食費になる行を、保存時に別の科目にしていれば、その科目が戻る)', async () => {
    const accounts = new SqlJsAccountRepository(db)
    const other = accounts.create({ category: 'expense', name: '交際費', isReconcilable: null })
    new SqlJsKeywordRuleRepository(db).create({ pattern: 'スーパー', accountId: accounts.findAll().find((a) => a.name === '食費')!.id })
    renderScreen()
    await chooseCsv(CSV3)
    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    pick(rowOf(/スーパー/), '相手科目', other.name)
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()

    await resume()

    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('交際費')
  })

  it('保存したあとに確定済みになった行は、再開時に重複(取り込み済み)として自動で除外される', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    // 一時保存のあとに、スーパーだけを確定する(ほかの行は相手科目が未選択なので確定できず残る)
    fireEvent.click(confirmButton(1, 3))
    await screen.findByText(/1件を確定しました/)
    expect(userEntries()).toHaveLength(1)
    restartScreen()

    await resume()

    // 取り込み済みの行は「重複」タブに分かれる(計画Issue #263)
    fireEvent.click(await screen.findByRole('tab', { name: /^重複/ }))
    expect(rowOf(/スーパー/).getByText('取り込み済みのため対象外です')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^0 \/ 2 件を「普通預金」に確定$/ })).toBeInTheDocument()
  })

  it('保存してから削除された参照先(プロジェクト)を指す入力は戻さず、戻せなかった件数を通知する。ほかの入力は戻る', async () => {
    const trip = projects.create({ name: '沖縄旅行' })
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    pick(rowOf(/スーパー/), 'プロジェクト', trip.name)
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    db.run('DELETE FROM projects WHERE id = ?', [trip.id])
    restartScreen()

    await resume()

    expect(await screen.findByText(/保存した入力のうち1件は、削除された取引先・科目・プロジェクトなどを指していたため、戻せませんでした/)).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
  })

  it('取り込むファイルのチェックを外して保存していれば、再開してもチェックは外れたままで、戻すと保存した入力が戻る', async () => {
    renderScreen()
    await chooseCsvs([SEP, OCT], /2ファイルを読み込み済み/)
    pick(rowOf(/Spotify/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('checkbox', { name: 'sep.csvを取り込む' }))
    await screen.findByText(/oct\.csv を読み込み済み/)
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()

    await resume()

    expect(screen.getByRole('checkbox', { name: 'sep.csvを取り込む' })).not.toBeChecked()
    expect(screen.queryByRole('row', { name: /Spotify/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'sep.csvを取り込む' }))
    await screen.findByRole('row', { name: /Spotify/ })
    expect(rowOf(/Spotify/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
  })

  it('再開した直後は、入力が保存済みなので、他の画面へ移るときに未保存の警告を出さない', async () => {
    await saveSuperDraft()
    await resume()

    fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/other')
  })
})

describe('破棄と後始末', () => {
  async function saveSuperDraft() {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    restartScreen()
  }

  it('「破棄」を押すと確認が出て、「破棄する」で一時保存(とCSV)を削除し、一覧からも消える。キャンセルでは残る', async () => {
    await saveSuperDraft()

    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を破棄' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '一時保存を破棄しますか' })).getByRole('button', { name: 'キャンセル' }))
    expect(drafts.findSummaries()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '普通預金の一時保存を破棄' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '一時保存を破棄しますか' })).getByRole('button', { name: '破棄する' }))

    await waitFor(() => expect(drafts.findSummaries()).toEqual([]))
    expect(screen.queryByRole('region', { name: '一時保存した取込' })).not.toBeInTheDocument()
    expect(db.exec('SELECT COUNT(*) FROM statement_import_draft_files')[0].values[0][0]).toBe(0)
  })

  it('再開して全行を確定すると、一時保存が削除される(CSVの生データがDBに残らない)', async () => {
    await saveSuperDraft()
    await resume()
    pick(rowOf(/ランチ/), '相手科目', '食費')
    pick(rowOf(/家賃/), '相手科目', '食費')

    fireEvent.click(confirmButton(3, 3))

    await screen.findByText(/確定しました。続けて明細を選択してください。/)
    expect(drafts.findSummaries()).toEqual([])
    expect(db.exec('SELECT COUNT(*) FROM statement_import_draft_files')[0].values[0][0]).toBe(0)
    expect(userEntries()).toHaveLength(3)
  })

  it('一部の行しか確定できないときは、一時保存は残る', async () => {
    await saveSuperDraft()
    await resume()

    fireEvent.click(confirmButton(1, 3))

    await screen.findByText(/1件を確定しました。未入力の2件は確定していません/)
    expect(drafts.findSummaries()).toHaveLength(1)
  })
})

describe('保存時の定義で読めないとき', () => {
  async function saveThenDeleteDefinition() {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    db.run('DELETE FROM import_mapping_definitions')
    restartScreen()
  }

  it('保存時のマッピング定義が削除されていると、一覧は開かず、理由と定義の作り直し・破棄の案内を出す(一時保存は残る)', async () => {
    await saveThenDeleteDefinition()

    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を再開' }))

    const panel = await screen.findByRole('alert', { name: /一時保存のCSV.*読み取れません/ })
    expect(within(panel).getByRole('button', { name: 'このCSVでマッピングを新規作成' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '一時保存を破棄' })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
    expect(drafts.findSummaries()).toHaveLength(1)
  })

  /** 一時保存したあとに、マッピング定義を編集する(削除はしない)。画面を開き直す */
  async function saveThenEditDefinition(sql: string) {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    db.run(sql)
    restartScreen()
  }

  it('保存したあとに、定義の列名が編集されてCSVを読み取れなくなったときも、一覧は開かず、案内を出す(定義は残っていて、一時保存も残る)', async () => {
    await saveThenEditDefinition("UPDATE import_mapping_definitions SET date_column = '存在しない列'")

    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を再開' }))

    const panel = await screen.findByRole('alert', { name: /一時保存のCSV.*読み取れません/ })
    expect(within(panel).getByRole('button', { name: 'このCSVでマッピングを新規作成' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '一時保存を破棄' })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()
    expect(mappings.findAll()).toHaveLength(1)
    expect(drafts.findSummaries()).toHaveLength(1)
  })

  it('保存したあとに、定義の表示名だけが編集されて、CSVはいまも読めるときは、編集後の定義で再開でき、保存した入力が戻る', async () => {
    await saveThenEditDefinition("UPDATE import_mapping_definitions SET label = '名前を変えた定義'")

    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を再開' }))

    await screen.findByText(/から再開しました/)
    expect(screen.queryByRole('alert', { name: /読み取れません/ })).not.toBeInTheDocument()
    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    expectTargetAccount(bank.name)
  })

  it('「このCSVでマッピングを新規作成」で定義を作り直すと、保存した取込先と入力が戻り、続きから再開できる', async () => {
    await saveThenDeleteDefinition()
    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を再開' }))
    const panel = await screen.findByRole('alert', { name: /一時保存のCSV.*読み取れません/ })

    fireEvent.click(within(panel).getByRole('button', { name: 'このCSVでマッピングを新規作成' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'マッピングを新規作成' }))
    fireEvent.change(dialog.getByLabelText('表示名'), { target: { value: '作り直した定義' } })
    fireEvent.change(dialog.getByLabelText('金融機関名'), { target: { value: '__new__' } })
    fireEvent.change(dialog.getByLabelText('新しい金融機関名'), { target: { value: 'my-bank-2' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存して取り込む' }))

    await screen.findByText(/から再開しました/)
    expectTargetAccount(bank.name)
    expect(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ })).toHaveTextContent('食費')
    expect(screen.queryByRole('alert', { name: /読み取れません/ })).not.toBeInTheDocument()
  })

  it('「一時保存を破棄」を押すと確認のあとに削除され、開始状態に戻る', async () => {
    await saveThenDeleteDefinition()
    fireEvent.click(await screen.findByRole('button', { name: '普通預金の一時保存を再開' }))
    const panel = await screen.findByRole('alert', { name: /一時保存のCSV.*読み取れません/ })

    fireEvent.click(within(panel).getByRole('button', { name: '一時保存を破棄' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '一時保存を破棄しますか' })).getByRole('button', { name: '破棄する' }))

    await waitFor(() => expect(drafts.findSummaries()).toEqual([]))
    expect(screen.queryByRole('alert', { name: /読み取れません/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'CSVの選択' })).toBeInTheDocument()
  })
})

describe('未保存の警告(保存して移動 / 一時保存して移動)', () => {
  const leave = () => fireEvent.click(screen.getByRole('link', { name: '他の画面へ' }))

  it('警告に、入力済みの件数と確定できない件数を含めて、「保存して移動」と「一時保存して移動」の違いを説明する', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    leave()

    const dialog = within(screen.getByRole('dialog', { name: '未保存の変更があります' }))
    expect(dialog.getByText(/入力済みの1件を確定し、確定できない2件は一時保存してから移動します/)).toBeInTheDocument()
    expect(dialog.getByText(/何も確定せず、3件の入力を一時保存してから移動します/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '一時保存して移動' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '保存して移動' })).toBeInTheDocument()
  })

  it('「一時保存して移動」は、何も確定せず、すべての入力を一時保存して移動する', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    leave()
    fireEvent.click(screen.getByRole('button', { name: '一時保存して移動' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
    expect(userEntries()).toHaveLength(0)
    expect(drafts.findSummaries()).toHaveLength(1)
    expect(drafts.findSummaries()[0]).toMatchObject({ totalRows: 3, filledRows: 1 })
  })

  it('「保存して移動」は、入力済みの行を確定し、確定できない行を一時保存してから移動する', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    leave()
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
    expect(userEntries()).toHaveLength(1)
    const [summary] = drafts.findSummaries()
    expect(summary).toMatchObject({ totalRows: 2, filledRows: 0 })
  })

  it('「保存して移動」で全行を確定できたときは、一時保存は作らず、再開していた一時保存は削除する', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    pick(rowOf(/ランチ/), '相手科目', '食費')
    pick(rowOf(/家賃/), '相手科目', '食費')

    leave()
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/other'))
    expect(userEntries()).toHaveLength(3)
    expect(drafts.findSummaries()).toEqual([])
  })

  it('「破棄して移動」は、何も保存せず・確定せずに移動する', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    leave()
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/other')
    expect(drafts.findSummaries()).toEqual([])
    expect(userEntries()).toHaveLength(0)
  })

  it('確定に関するエラー(誰の明細か未選択)で確定できないときは、移動せず、一時保存も作らない', async () => {
    renderScreen()
    fireEvent.change(await screen.findByLabelText('CSVを選択'), {
      target: { files: [new File([CSV3], 'statement.csv', { type: 'text/csv' })] },
    })
    await screen.findByText(/statement\.csv を読み込み済み/)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    leave()
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '未保存の変更があります' })).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/master/here')
    expect(drafts.findSummaries()).toEqual([])
  })
})

describe('取込先が違う一時保存', () => {
  it('別の取込先(楽天VISA)の一時保存は、別々に持て、一覧にどちらも出る', async () => {
    renderScreen()
    await chooseCsv(CSV3)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(saveButtons()[0])
    await screen.findByText(/一時保存しました/)
    drafts.save({
      targetAccountId: card.id,
      definitionId: null,
      ownerMemberId: null,
      files: [{ fileName: 'card.csv', bytes: new TextEncoder().encode(CSV3), isChecked: true }],
      rowInputs: {},
      totalRows: 5,
      filledRows: 0,
    })
    restartScreen()

    const list = await draftList()
    await list.findByText('普通預金')
    expect(list.getByText('楽天VISA')).toBeInTheDocument()
  })
})
