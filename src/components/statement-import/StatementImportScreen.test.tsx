// @vitest-environment jsdom
/**
 * StatementImportScreen(明細取込画面、計画Issue #151)のコンポーネントテスト。
 * アップロードとレビューを1画面にまとめた画面: 取込先とCSVの選択、マッピング定義の絞り込み
 * (1つなら自動選択・複数なら選択、取り込むと取込先との紐づけを追加)、1件1行の一覧、取引先推定と
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
  accounts.create({ category: 'asset', name: '立替金', isReconcilable: false })
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
    ...overrides,
  })
}

const HEADER = '日付,摘要,金額,残高\n'
const csvFile = (content: string, name = 'statement.csv') => new File([content], name, { type: 'text/csv' })

/** 取込先とCSVを選ぶ。waitLoadedがtrue(既定)なら、一覧が表示されるまで待つ */
async function chooseCsv(content: string, waitLoaded = true) {
  fireEvent.change(await screen.findByLabelText('取込先'), { target: { value: String(bank.id) } })
  fireEvent.change(screen.getByLabelText('CSVを選択'), { target: { files: [csvFile(content)] } })
  if (waitLoaded) await screen.findByText(/statement\.csv を読み込み済み/)
}

/** 補助行(確定版の確認・パターン登録)にも同じ摘要の文字列が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

describe('StatementImportScreen', () => {
  it('取込先とCSVを選ぶと、同じ画面に1件1行で日付・摘要・金額・状態が表示され、件数が要約される', async () => {
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

    expect(await screen.findByRole('alert')).toHaveTextContent('一致するマッピング定義が見つかりませんでした')
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
    fireEvent.click(screen.getByRole('button', { name: '1 件を確定' }))
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

  it('確定すると仕訳が作られ、同じ画面で続けて次のCSVを取り込める', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.change(rowOf(/スーパー/).getByLabelText('スーパーのコメント'), { target: { value: 'まとめ買い' } })

    fireEvent.click(screen.getByRole('button', { name: '1 件を確定' }))

    expect(await screen.findByText(/確定しました。続けて次のCSVを取り込めます。/)).toBeInTheDocument()
    const created = entries.findAll()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ comment: 'まとめ買い', sourceType: 'external_import' })
    expect(screen.queryByRole('row', { name: /スーパー/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('CSVを選択'), { target: { files: [csvFile(`${HEADER}2026/10/07,カフェ,-500,96700\n`, 'next.csv')] } })
    expect(await screen.findByText(/next\.csv を読み込み済み/)).toBeInTheDocument()
  })

  it('相手科目が未選択の行は確定に失敗し、理由を表示する', async () => {
    makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    fireEvent.click(await screen.findByRole('button', { name: '1 件を確定' }))

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
        { accountId: food.id, side: 'debit', amount: 3000 },
        { accountId: bank.id, side: 'credit', amount: 3000 },
      ],
    })
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(await screen.findByLabelText('これは確定版です'))

    fireEvent.click(screen.getByRole('button', { name: '1 件を確定' }))

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
    fireEvent.click(screen.getByRole('button', { name: '1 件を確定' }))

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

  it('列が同じで複数の定義に一致するときは、取込先に紐づく定義を先頭に選ばせ、取り込むと紐づけを追加する', async () => {
    const other = makeMapping({ label: '汎用の定義' })
    const linked = makeMapping({ label: '普通預金用', accountIds: [bank.id] })
    renderScreen()

    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`, false)

    const select = await screen.findByLabelText('マッピング定義')
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['選択してください', '普通預金用', '汎用の定義'])
    fireEvent.change(select, { target: { value: String(other.id) } })
    await screen.findByText(/statement\.csv を読み込み済み/)
    pick(rowOf(/スーパー/), '相手科目', '食費')
    fireEvent.click(await screen.findByRole('button', { name: '1 件を確定' }))

    await screen.findByText(/確定しました/)
    expect(mappings.findById(other.id)?.accountIds).toEqual([bank.id])
    expect(mappings.findById(linked.id)?.accountIds).toEqual([bank.id])
  })

  it('候補が1つなら自動で選ばれ、確定するとその科目との紐づけが追加される', async () => {
    const only = makeMapping()
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    pick(rowOf(/スーパー/), '相手科目', '食費')

    fireEvent.click(screen.getByRole('button', { name: '1 件を確定' }))

    await screen.findByText(/確定しました/)
    expect(mappings.findById(only.id)?.accountIds).toEqual([bank.id])
  })

  it('「マッピングを編集」を押すと、マスタの明細マッピングへ移動するコールバックが呼ばれる', async () => {
    renderScreen()

    fireEvent.click(await screen.findByRole('button', { name: 'マッピングを編集' }))

    expect(onEditMappings).toHaveBeenCalledTimes(1)
  })
})
