// @vitest-environment jsdom
/**
 * StatementImportScreen(明細取込画面、計画Issue #151)のコンポーネントテスト。
 * アップロードとレビューを1画面にまとめた画面: CSVの選択、全マッピング定義への実パース試行による絞り込み
 * (1つなら自動選択・複数なら選択)、定義に紐づく科目を初期値にした取込先の確認と変更(紐づく科目が無ければ
 * 選ぶまで一覧を出さない、取り込むと紐づけを追加)、一致する定義が無いときの画面内での定義の作成、1件1行の一覧、取引先推定と
 * 相手科目のサジェスト、重複の行(入力・選択なし、「取り込む」で戻せる)、選択した行への一括設定
 * (対象外の件数)、確定版の候補の置き換え、残高照合、確定とパターン登録、確定後に続けて次のCSVを
 * 取り込めることを、sql.jsのNode実装(createTestDatabase)を使って確認する。
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
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsExternalTransactionRefRepository } from '../../infrastructure/db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { StatementImportScreen } from './StatementImportScreen'

let db: Database
let accounts: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository
let counterparties: SqlJsCounterpartyRepository
let projects: SqlJsProjectRepository
let mappings: SqlJsImportMappingDefinitionRepository
let batches: SqlJsSettlementBatchRepository
let memberId: number
let bank: ReturnType<SqlJsAccountRepository['create']>
let food: ReturnType<SqlJsAccountRepository['create']>
let onEditMappings: () => void

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
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

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <StatementImportScreen
        accountRepository={accounts}
        accountGroupRepository={new SqlJsAccountGroupRepository(db)}
        importMappingDefinitionRepository={mappings}
        externalTransactionRefRepository={new SqlJsExternalTransactionRefRepository(db)}
        journalEntryRepository={entries}
        counterpartyRepository={counterparties}
        counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
        projectRepository={projects}
        projectGroupRepository={new SqlJsProjectGroupRepository(db)}
        householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
        settlementBatchRepository={batches}
        onEditMappings={onEditMappings}
      />
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

/** 補助行(確定版の確認・パターン登録)にも同じ摘要の文字列が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

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

  it('取引先の推定と、取引先の既定の科目が初期値として入る', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'セブン', defaultAccountId: food.id })
    counterparties.addPattern(cp.id, 'セブンイレブン')
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,セブンイレブン 新宿,-640,99360\n`)

    const row = rowOf(/セブンイレブン/)
    expect(await row.findByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
    expect(row.getByRole('button', { name: /^取引先: セブン/ })).toBeInTheDocument()
    expect(row.getByText('新規')).toBeInTheDocument()
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
    const created = entries.findAll()
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
    expect(entries.findAll()[0]).toMatchObject({ householdMemberId: hanako.id })
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
    const created = entries.findAll()[0]
    expect(created.householdMemberId).toBe(hanako.id)
    expect(created.lines.map((l) => l.householdMemberId)).toEqual([hanako.id, hanako.id])
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

  it('相手科目が未選択の行は確定に失敗し、理由を表示する', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    fireEvent.click(await screen.findByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

    expect(await screen.findByText(/相手科目が未選択です/)).toBeInTheDocument()
    expect(entries.findAll()).toHaveLength(0)
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
    expect(entries.findAll().map((e) => e.sourceType)).toEqual(['external_import'])
  })

  it('残高が照合対象の取込先では、帳簿残高と明細の残高の一致・不一致を表示する', async () => {
    makeMapping()
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    expect(await screen.findByText(/帳簿残高.*外部残高.*一致しません/)).toBeInTheDocument()
  })

  it('取引先を選んだ行は確定時にパターンを登録し、件数を伝える', async () => {
    makeMapping()
    const cp = counterparties.create({ name: 'スーパーA' })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー 新宿店,-3000,97000\n`)
    pick(rowOf(/スーパー 新宿店/), '相手科目', '食費')
    pick(rowOf(/スーパー 新宿店/), '取引先', 'スーパーA')
    // パターン登録は明細の行の直下の補助行にある
    expect(screen.getByLabelText('パターン登録')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'スーパー 新宿店のパターンを変更' }))
    fireEvent.change(screen.getByLabelText('スーパー 新宿店から登録するパターン'), { target: { value: 'スーパー' } })
    fireEvent.click(screen.getByRole('button', { name: /^1 件を「普通預金」に確定$/ }))

    expect(await screen.findByText(/パターンを1件登録しました/)).toBeInTheDocument()
    expect(counterparties.findByPattern('スーパー').map((p) => p.counterpartyId)).toEqual([cp.id])
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
    const accountIds = entries.findAll()[0].lines.map((l) => l.accountId)
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
    expect(entries.findAll()).toHaveLength(1)
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
