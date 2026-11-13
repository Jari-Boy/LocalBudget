// @vitest-environment jsdom
/**
 * MappingMasterTab(計画Issue #151)のコンポーネントテスト。
 * マスタ画面の「明細マッピング」タブ: 定義の一覧(表示名・対応する科目・明細の種類)、右パネルでの編集、
 * 選んだCSVの元データと取り込み結果のプレビュー(符号付き1列・入金出金2列、読み取れない行の理由)、
 * 文字コード変更時のCSV読み直し、必須の列が足りない定義の保存不可と理由の表示、複数の科目の指定、
 * CSVからの新規作成(推測した下書き)、複製、2回押しの削除を、sql.jsのNode実装
 * (createTestDatabase)を使って確認する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { MappingMasterTab } from './MappingMasterTab'

let db: Database
let mappings: SqlJsImportMappingDefinitionRepository
let cardId: number
let bankId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  mappings = new SqlJsImportMappingDefinitionRepository(db)
  const accounts = new SqlJsAccountRepository(db)
  cardId = accounts.create({
    category: 'liability',
    name: '楽天VISA',
    isReconcilable: false,
    hasExternalStatement: true,
  }).id
  bankId = accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true }).id
  // 外部明細なしの科目(明細マッピングの対応する科目には選べない、計画Issue #189)
  accounts.create({ category: 'asset', name: '現金', isReconcilable: false, hasExternalStatement: false })
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <MappingMasterTab
        importMappingDefinitionRepository={mappings}
        accountRepository={new SqlJsAccountRepository(db)}
        accountGroupRepository={new SqlJsAccountGroupRepository(db)}
      />
    </I18nextProvider>,
  )
}

function makeMapping(overrides: Partial<Parameters<typeof mappings.create>[0]> = {}) {
  return mappings.create({
    formatGroupId: '楽天カード',
    label: '楽天カード(確定)',
    isSettled: true,
    dateColumn: '利用日',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '利用店名',
    amountMode: 'single_signed',
    amountColumn: '利用金額',
    accountIds: [cardId],
    ...overrides,
  })
}

const SIGNED_CSV = '利用日,利用店名,利用金額\n2026/10/05,コンビニ,-300\n2026/10/11,給与,250000\n'
const SPLIT_CSV = '日付,摘要,出金,入金\n2026/10/05,ATM,5000,\n2026/10/06,給与,,250000\n'

const panel = () => within(screen.getByRole('region', { name: 'マッピングの編集' }))
const csvFile = (content: string) => new File([content], 'sample.csv', { type: 'text/csv' })

async function openMapping(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

function loadCsv(content: string) {
  fireEvent.change(panel().getByLabelText('プレビュー用のCSV'), { target: { files: [csvFile(content)] } })
}

describe('MappingMasterTab', () => {
  it('一覧に、表示名・対応する科目・明細の種類が表示される', async () => {
    makeMapping()
    makeMapping({ label: '楽天銀行', formatGroupId: '楽天銀行', isSettled: null, accountIds: [] })

    renderTab()

    const card = await screen.findByRole('button', { name: /楽天カード\(確定\)/ })
    expect(card).toHaveTextContent('楽天VISA ・ 確定')
    expect(screen.getByRole('button', { name: /^楽天銀行/ })).toHaveTextContent('科目の指定なし ・ 区別なし')
  })

  it('一覧は金融機関名の見出しでグループ化され、同じ金融機関の定義が見出しの下に確定→速報の順で並ぶ(計画Issue #183)', async () => {
    makeMapping({ label: '楽天カード(速報)', isSettled: false })
    makeMapping({ label: '楽天銀行', formatGroupId: '楽天銀行', isSettled: null, accountIds: [] })
    makeMapping({ label: '楽天カード(確定)', isSettled: true })

    renderTab()

    await screen.findByRole('button', { name: /楽天カード\(確定\)/ })
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => within(g).getByRole('heading').textContent)).toEqual(['楽天カード', '楽天銀行'])
    expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('楽天カード(確定)'),
      expect.stringContaining('楽天カード(速報)'),
    ])
    expect(within(groups[1]).getAllByRole('button')).toHaveLength(1)
  })

  it('定義を選ぶと、右パネルに保存済みの値が入る', async () => {
    makeMapping({ accountIds: [cardId, bankId] })

    renderTab()
    await openMapping('楽天カード')

    expect(panel().getByLabelText('表示名')).toHaveValue('楽天カード(確定)')
    expect(panel().getByLabelText('金融機関名')).toHaveValue('楽天カード')
    expect(panel().getByLabelText('明細の種類')).toHaveValue('settled')
    expect(panel().getByLabelText('文字コード')).toHaveValue('utf-8')
    expect(panel().getByLabelText('日付の書式')).toHaveValue('YYYY/MM/DD')
    expect(panel().getByLabelText('金額の形式')).toHaveValue('single_signed')
    expect(panel().getByRole('button', { name: '楽天VISAを外す' })).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '楽天銀行を外す' })).toBeInTheDocument()
  })

  it('金融機関名は既存の定義の金融機関名から選べ、候補にない名前は新規入力で保存できる(計画Issue #183)', async () => {
    makeMapping()
    makeMapping({ label: '楽天銀行', formatGroupId: '楽天銀行', isSettled: null, accountIds: [] })
    renderTab()
    await openMapping('楽天カード')

    expect(panel().getByRole('option', { name: '楽天銀行' })).toBeInTheDocument()
    fireEvent.change(panel().getByLabelText('金融機関名'), { target: { value: '__new__' } })
    fireEvent.change(panel().getByLabelText('新しい金融機関名'), { target: { value: ' 三井住友 カード ' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mappings.findAll().some((d) => d.formatGroupId === '三井住友カード')).toBe(true))
  })

  it('CSVを選ぶと元のCSVと取り込み結果が並び、全行が読み取れれば件数を表示する', async () => {
    makeMapping()
    renderTab()
    await openMapping('楽天カード')

    loadCsv(SIGNED_CSV)

    expect(await panel().findByText('✓ 全2行を読み取れます')).toBeInTheDocument()
    const preview = within(panel().getByRole('table', { name: '取り込み結果のプレビュー' }))
    expect(preview.getByText('2026-10-05')).toBeInTheDocument()
    expect(preview.getByText('-¥300')).toBeInTheDocument()
    expect(preview.getByText('+¥250,000')).toBeInTheDocument()
  })

  it('金額の形式を入金・出金の2列にして列を割り当てると、入金−出金で金額がプレビューされる', async () => {
    makeMapping({ label: '別形式', dateColumn: '日付', descriptionColumn: '摘要', amountColumn: '出金' })
    renderTab()
    await openMapping('別形式')
    loadCsv(SPLIT_CSV)
    await panel().findByText('✓ 全2行を読み取れます')

    fireEvent.change(panel().getByLabelText('金額の形式'), { target: { value: 'debit_credit_split' } })
    fireEvent.change(panel().getByLabelText('出金額の列'), { target: { value: '出金' } })
    fireEvent.change(panel().getByLabelText('入金額の列'), { target: { value: '入金' } })

    const preview = within(panel().getByRole('table', { name: '取り込み結果のプレビュー' }))
    expect(await preview.findByText('-¥5,000')).toBeInTheDocument()
    expect(preview.getByText('+¥250,000')).toBeInTheDocument()
  })

  it('読み取れない行は、行ごとに理由を表示し、件数を伝える', async () => {
    makeMapping()
    renderTab()
    await openMapping('楽天カード')

    loadCsv('利用日,利用店名,利用金額\n2026/10/05,A,-300\n不正,B,100\n2026/10/07,C,abc\n')

    expect(await panel().findByText('2行を読み取れません(全3行)')).toBeInTheDocument()
    expect(panel().getByText('読み取れない行は、取り込まれません(保存はできます)。')).toBeInTheDocument()
    // 読み取れない行があっても、必須の列が足りているので保存できる(計画Issue #151)
    expect(panel().getByRole('button', { name: '保存' })).toBeEnabled()
    expect(panel().getByText('日付を読み取れません')).toBeInTheDocument()
    expect(panel().getByText('金額を読み取れません')).toBeInTheDocument()
  })

  it('読み取れない行の方が多いときは警告を出すが、保存はできる(計画Issue #151)', async () => {
    makeMapping()
    renderTab()
    await openMapping('楽天カード')

    loadCsv('利用日,利用店名,利用金額\n2026/10/05,A,-300\n不正,B,100\n不正,C,200\n')

    expect(await panel().findByText(/読み取れない行の方が多いです/)).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('読み取れない行が少ないときは、多い旨の警告は出さない', async () => {
    makeMapping()
    renderTab()
    await openMapping('楽天カード')

    loadCsv('利用日,利用店名,利用金額\n2026/10/05,A,-300\n2026/10/06,B,100\n不正,C,200\n')

    expect(await panel().findByText('1行を読み取れません(全3行)')).toBeInTheDocument()
    expect(panel().queryByText(/読み取れない行の方が多いです/)).not.toBeInTheDocument()
  })

  it('指定した列がCSVに見つからないときは、その旨を表示する', async () => {
    makeMapping({ amountColumn: '存在しない列' })
    renderTab()
    await openMapping('楽天カード')

    loadCsv(SIGNED_CSV)

    expect(await panel().findByText(/CSVに見つかりません/)).toBeInTheDocument()
  })

  it('必須の列が足りない定義は保存できず、理由を表示する', async () => {
    const created = makeMapping()
    renderTab()
    await openMapping('楽天カード')

    fireEvent.change(panel().getByLabelText('金額の列'), { target: { value: '' } })

    expect(panel().getByRole('button', { name: '保存' })).toBeDisabled()
    expect(panel().getByText('金額の列を指定してください')).toBeInTheDocument()
    expect(mappings.findById(created.id)?.amountColumn).toBe('利用金額')
  })

  it('編集して保存すると、定義が更新される', async () => {
    const created = makeMapping()
    renderTab()
    await openMapping('楽天カード')

    fireEvent.change(panel().getByLabelText('表示名'), { target: { value: '楽天カード(改)' } })
    fireEvent.change(panel().getByLabelText('明細の種類'), { target: { value: 'provisional' } })
    fireEvent.change(panel().getByLabelText('文字コード'), { target: { value: 'shift-jis' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mappings.findById(created.id)?.label).toBe('楽天カード(改)'))
    expect(mappings.findById(created.id)).toMatchObject({ isSettled: false, encoding: 'shift-jis' })
  })

  it('文字コードを変えると、選んだCSVを読み直してプレビューを更新する', async () => {
    makeMapping({ label: 'SJIS', dateColumn: '日付', descriptionColumn: '摘要', amountColumn: '金額' })
    renderTab()
    await openMapping('SJIS')
    // 「日付,摘要,金額」「2026/10/05,あ,100」のShift-JISバイト列
    const bytes = new Uint8Array([
      0x93, 0xfa, 0x95, 0x74, 0x2c, 0x93, 0x45, 0x97, 0x76, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x0a,
      ...new TextEncoder().encode('2026/10/05,'),
      0x82, 0xa0,
      ...new TextEncoder().encode(',100\n'),
    ])
    fireEvent.change(panel().getByLabelText('プレビュー用のCSV'), {
      target: { files: [new File([bytes], 's.csv')] },
    })
    expect(await panel().findByText(/CSVに見つかりません/)).toBeInTheDocument()

    fireEvent.change(panel().getByLabelText('文字コード'), { target: { value: 'shift-jis' } })

    expect(await panel().findByText('✓ 全1行を読み取れます')).toBeInTheDocument()
    expect(within(panel().getByRole('table', { name: '取り込み結果のプレビュー' })).getByText('あ')).toBeInTheDocument()
  })

  it('対応する科目を複数指定して保存でき、外すこともできる', async () => {
    const created = makeMapping({ accountIds: [cardId] })
    renderTab()
    await openMapping('楽天カード')

    fireEvent.click(panel().getByRole('button', { name: /^対応する科目/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '対応する科目' })).getByRole('button', { name: '楽天銀行' }))
    fireEvent.click(panel().getByRole('button', { name: '楽天VISAを外す' }))
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mappings.findById(created.id)?.accountIds).toEqual([bankId]))
  })

  it('対応する科目の選択肢には、外部明細がある科目だけが並び、外部明細なしの科目(現金)は出ない(計画Issue #189)', async () => {
    makeMapping({ accountIds: [cardId] })
    renderTab()
    await openMapping('楽天カード')

    fireEvent.click(panel().getByRole('button', { name: /^対応する科目/ }))

    const dialog = within(screen.getByRole('dialog', { name: '対応する科目' }))
    expect(dialog.getByRole('button', { name: '楽天銀行' })).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: '現金' })).not.toBeInTheDocument()
  })

  it('「CSVから新規作成」でCSVを選ぶと、文字コードと列を推測した下書きが開き、名前を付けて保存すると作られる', async () => {
    renderTab()
    fireEvent.change(await screen.findByLabelText('新規作成に使うCSV'), { target: { files: [csvFile(SIGNED_CSV)] } })

    await screen.findByRole('region', { name: 'マッピングの編集' })
    expect(panel().getByText('列を推測しました。内容を確認してください')).toBeInTheDocument()
    expect(panel().getByLabelText('金額の列')).toHaveValue('利用金額')
    expect(panel().getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.change(panel().getByLabelText('表示名'), { target: { value: '新しい形式' } })
    fireEvent.change(panel().getByLabelText('金融機関名'), { target: { value: '__new__' } })
    fireEvent.change(panel().getByLabelText('新しい金融機関名'), { target: { value: 'new-bank' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mappings.findAll()).toHaveLength(1))
    expect(mappings.findAll()[0]).toMatchObject({ label: '新しい形式', formatGroupId: 'new-bank', dateColumn: '利用日' })
  })

  it('複製すると、科目の紐づけも含めて「のコピー」が作られる', async () => {
    makeMapping()
    renderTab()
    await openMapping('楽天カード')

    fireEvent.click(panel().getByRole('button', { name: '複製' }))

    await waitFor(() => expect(mappings.findAll()).toHaveLength(2))
    expect(mappings.findAll()[1]).toMatchObject({ label: '楽天カード(確定)のコピー', accountIds: [cardId] })
  })

  it('削除は2回押しで確定し、定義が消える', async () => {
    const created = makeMapping()
    renderTab()
    await openMapping('楽天カード')

    fireEvent.click(panel().getByRole('button', { name: '削除' }))
    expect(mappings.findById(created.id)).not.toBeNull()
    fireEvent.click(panel().getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(mappings.findById(created.id)).toBeNull())
  })
})
