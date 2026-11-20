// @vitest-environment jsdom
/**
 * StatementImportScreen の複数CSV一括取込(計画Issue #214)のコンポーネントテスト。
 * 複数のCSVを選ぶと1つの一覧に日付順で並ぶこと、ファイルの一覧(名称・期間・件数・取り込むかのチェック)、
 * 合わないファイルだけを「取り込めなかったファイル」に理由つきで出して残りで続行できること、
 * 期間が重なるファイルの同じ明細を「ファイル間の重複」として対象外にし重複元の行へ移動できること、
 * 取込済みの仕訳をその場で確認できること、「取り込まない行」にファイル名が付くこと、
 * 確定でファイル間の重複行が仕訳にならないこと、1ファイルだけのときは従来の画面のままであることを確認する。
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
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsExternalTransactionRefRepository } from '../../infrastructure/db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { SqlJsStatementImportDraftRepository } from '../../infrastructure/db/SqlJsStatementImportDraftRepository'
import { UnsavedGuardHarness } from '../master/UnsavedGuardHarness'
import { chooseMember, findMemberButton } from '../master/memberSelectTestHelpers'
import { StatementImportScreen } from './StatementImportScreen'

let db: Database
let entries: SqlJsJournalEntryRepository

beforeEach(async () => {
  localStorage.clear()
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  const accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '自分' })
  const bank = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
  new SqlJsImportMappingDefinitionRepository(db).create({
    formatGroupId: 'my-bank',
    label: 'マイ銀行',
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    accountIds: [bank.id],
  })
  // jsdomにはscrollIntoViewが無い
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <StatementImportScreen
          accountRepository={new SqlJsAccountRepository(db)}
          accountGroupRepository={new SqlJsAccountGroupRepository(db)}
          importMappingDefinitionRepository={new SqlJsImportMappingDefinitionRepository(db)}
          externalTransactionRefRepository={new SqlJsExternalTransactionRefRepository(db)}
          journalEntryRepository={entries}
          counterpartyRepository={new SqlJsCounterpartyRepository(db)}
          keywordRuleRepository={new SqlJsKeywordRuleRepository(db)}
          counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
          projectRepository={new SqlJsProjectRepository(db)}
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

const HEADER = '日付,摘要,金額\n'
const SEP = { name: 'sep.csv', body: `${HEADER}2025/09/05,Spotify,-980\n` }
const OCT = { name: 'oct.csv', body: `${HEADER}2025/10/03,コンビニ,-420\n2025/10/26,Amazon,-2980\n` }
const NOV = { name: 'nov.csv', body: `${HEADER}2025/10/26,Amazon,-2980\n2025/11/03,書店,-1500\n` }

/** CSVをまとめて選ぶ。waitForが指定されたら、その表示まで待つ。科目に名義が無いので「誰の明細か」も選ぶ */
async function chooseCsvs(files: Array<{ name: string; body: string }>, waitFor?: RegExp) {
  const input = await screen.findByLabelText('CSVを選択')
  fireEvent.change(input, { target: { files: files.map((f) => new File([f.body], f.name, { type: 'text/csv' })) } })
  if (waitFor) {
    await screen.findByText(waitFor)
    if (screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })) chooseMember('誰の明細か(必須)', '自分')
  }
}

const rowsOf = (text: string | RegExp) => screen.getAllByRole('row', { name: text }).map((r) => within(r))
const rowOf = (text: string | RegExp) => rowsOf(text)[0]
const pick = (scope: ReturnType<typeof within>, label: string, item: string) => {
  fireEvent.click(scope.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: item }))
}

describe('StatementImportScreen: 複数CSVの一括取込', () => {
  it('複数のCSVを選ぶと、選んだ順に関係なく1つの一覧に日付順で並び、ファイル間の重複を除いた件数が要約される', async () => {
    renderScreen()

    await chooseCsvs([NOV, OCT], /2ファイルを読み込み済み/)

    expect(
      screen.getByText('2ファイルを読み込み済み。新規 3 件、取り込み済みで除外 0 件、ファイル間の重複で除外 1 件、確認が必要 3 件'),
    ).toBeInTheDocument()
    const dates = within(screen.getByRole('table', { name: '明細の一覧' }))
      .getAllByText(/^2025\/\d\d\/\d\d$/)
      .map((cell) => cell.textContent)
    // 重複の行(nov.csvのAmazon)が先頭のグループに出て、そのあと問題なしの行が日付順に並ぶ
    expect(dates).toEqual(['2025/10/26', '2025/10/03', '2025/10/26', '2025/11/03'])
  })

  it('一覧の左端に「ファイル」列が出て、各行の取込元のファイル名が分かる', async () => {
    renderScreen()

    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)

    const headers = within(screen.getByRole('table', { name: '明細の一覧' })).getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('ファイル')
    expect(rowOf(/コンビニ/).getByText('oct.csv')).toBeInTheDocument()
    expect(rowOf(/書店/).getByText('nov.csv')).toBeInTheDocument()
  })

  it('ファイルの一覧に、名称・期間・件数が出て、期間の重なるファイルには注記が付く', async () => {
    renderScreen()

    await chooseCsvs([NOV, OCT], /2ファイルを読み込み済み/)

    const list = within(screen.getByRole('list', { name: '取り込むCSV' }))
    const items = list.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('oct.csv')
    expect(items[0]).toContain('2025/10/03〜10/26')
    expect(items[0]).toContain('2件')
    expect(items[0]).toContain('他のファイルと期間が重なります')
    expect(items[1]).toContain('nov.csv')
    expect(list.getByRole('checkbox', { name: 'oct.csvを取り込む' })).toBeChecked()
    expect(list.getByRole('checkbox', { name: 'nov.csvを取り込む' })).toBeChecked()
  })

  it('ファイルのチェックを外すと、そのファイルを選ばなかったものとして一覧と件数を作り直す', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)

    fireEvent.click(screen.getByRole('checkbox', { name: 'nov.csvを取り込む' }))

    await screen.findByText(/oct\.csv を読み込み済み。新規 2 件、重複で除外 0 件/)
    expect(screen.queryByText('書店')).not.toBeInTheDocument()
    expect(rowsOf(/Amazon/)).toHaveLength(1)
    expect(rowOf(/Amazon/).queryByText(/重複のため対象外/)).not.toBeInTheDocument()
  })

  it('期間が重なる同じ明細は、先(期間の早い)のファイルの行を残し、後のファイルの行を「ファイル間の重複」として対象外にする', async () => {
    renderScreen()

    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)

    const [duplicate, original] = rowsOf(/Amazon/)
    expect(original.getByText('oct.csv')).toBeInTheDocument()
    expect(original.queryByText('重複・除外')).not.toBeInTheDocument()
    expect(duplicate.getByText('nov.csv')).toBeInTheDocument()
    expect(duplicate.getByText('ファイル「oct.csv」の同じ明細と重複のため対象外です')).toBeInTheDocument()
    expect(duplicate.getByText('重複・除外')).toBeInTheDocument()
    expect(duplicate.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('重複行の「重複元の行へ移動」で重複元の行へスクロールして強調し、重複元の行からも重複した行へ移れる', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    const [duplicate, original] = rowsOf(/Amazon/)

    fireEvent.click(duplicate.getByRole('button', { name: '重複元の行へ移動' }))

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.getAllByRole('row', { name: /Amazon/ })[1]).toHaveClass('import-row--flash')

    fireEvent.click(original.getByRole('button', { name: '重複した行へ移動' }))

    expect(screen.getAllByRole('row', { name: /Amazon/ })[0]).toHaveClass('import-row--flash')
  })

  describe('グループの折りたたみ(計画Issue #231 フェーズ1)', () => {
    const groupToggle = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}\\s*\\d+件`) })

    it('重複元の行のグループが折りたたまれていると、「重複元の行へ移動」で自動で開いてから強調する', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      fireEvent.click(groupToggle('問題なし'))
      expect(screen.getAllByRole('row', { name: /Amazon/ })).toHaveLength(1)

      fireEvent.click(rowOf(/Amazon/).getByRole('button', { name: '重複元の行へ移動' }))

      expect(groupToggle('問題なし')).toHaveAttribute('aria-expanded', 'true')
      const rows = screen.getAllByRole('row', { name: /Amazon/ })
      expect(rows).toHaveLength(2)
      expect(rows[1]).toHaveClass('import-row--flash')
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })

    it('重複した行のグループが折りたたまれていると、「重複した行へ移動」で自動で開いてから強調する', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      const original = rowsOf(/Amazon/)[1]
      fireEvent.click(groupToggle('重複'))
      expect(screen.getAllByRole('row', { name: /Amazon/ })).toHaveLength(1)

      fireEvent.click(original.getByRole('button', { name: '重複した行へ移動' }))

      expect(groupToggle('重複')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getAllByRole('row', { name: /Amazon/ })[0]).toHaveClass('import-row--flash')
    })

    it('取り込むファイルのチェックを切り替えて一覧を作り直しても、折りたたみの状態は保たれる', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      fireEvent.click(groupToggle('問題なし'))

      fireEvent.click(screen.getByRole('checkbox', { name: 'nov.csvを取り込む' }))

      await screen.findByText(/oct\.csv を読み込み済み/)
      expect(groupToggle('問題なし')).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('ヘッダーでの並び替え(計画Issue #231 フェーズ2)', () => {
    it('取り込むファイルのチェックを切り替えて一覧を作り直しても、並び替えの状態は保たれる', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      fireEvent.click(within(screen.getByRole('columnheader', { name: '金額' })).getByRole('button'))
      expect(screen.getByRole('columnheader', { name: '金額' })).toHaveAttribute('aria-sort', 'ascending')

      fireEvent.click(screen.getByRole('checkbox', { name: 'nov.csvを取り込む' }))

      await screen.findByText(/oct\.csv を読み込み済み/)
      expect(screen.getByRole('columnheader', { name: '金額' })).toHaveAttribute('aria-sort', 'ascending')
      // 金額の昇順: Amazon(-2,980) が コンビニ(-420) より先
      expect(rowsOf(/Amazon/)).toHaveLength(1)
      expect(
        rowOf(/Amazon/).getByText('-¥2,980').closest('tr')!.compareDocumentPosition(rowOf(/コンビニ/).getByText('-¥420').closest('tr')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    const header = (name: string) => screen.getByRole('columnheader', { name })
    const sortButton = (name: string) => within(header(name)).getByRole('button')
    const isBefore = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

    it('完全重複の行は入力済みの色にならず、「取り込む」に戻して相手科目を決めると入力済みの色になる', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      const duplicateRow = () => screen.getAllByRole('row', { name: /Amazon/ })[0]
      expect(duplicateRow()).not.toHaveClass('import-row--done')
      expect(duplicateRow()).toHaveClass('import-row--dup')

      fireEvent.click(within(duplicateRow()).getByRole('button', { name: '取り込む' }))
      expect(duplicateRow()).not.toHaveClass('import-row--done')

      pick(within(duplicateRow()), '相手科目', '食費')
      expect(duplicateRow()).toHaveClass('import-row--done')
    })

    it('並び替えたあとでも、「重複元の行へ移動」「重複した行へ移動」は正しい行へ移り、その行を強調する', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      // 日付の降順(コンビニ 10/03 と Amazon 10/26 が入れ替わる)
      fireEvent.click(sortButton('日付'))
      fireEvent.click(sortButton('日付'))
      expect(header('日付')).toHaveAttribute('aria-sort', 'descending')
      const convenience = screen.getAllByRole('row', { name: /コンビニ/ })[0]
      const original = screen.getAllByRole('row', { name: /Amazon/ })[1]
      expect(isBefore(original, convenience)).toBe(true)

      fireEvent.click(within(screen.getAllByRole('row', { name: /Amazon/ })[0]).getByRole('button', { name: '重複元の行へ移動' }))

      // 重複元はoct.csvのAmazonの行(nov.csvの重複した行ではない)
      const flashed = screen.getAllByRole('row', { name: /Amazon/ }).filter((r) => r.classList.contains('import-row--flash'))
      expect(flashed).toHaveLength(1)
      expect(within(flashed[0]).getByText('oct.csv')).toBeInTheDocument()

      fireEvent.click(within(screen.getAllByRole('row', { name: /Amazon/ })[1]).getByRole('button', { name: '重複した行へ移動' }))

      const flashedBack = screen.getAllByRole('row', { name: /Amazon/ }).filter((r) => r.classList.contains('import-row--flash'))
      expect(flashedBack).toHaveLength(1)
      expect(within(flashedBack[0]).getByText('nov.csv')).toBeInTheDocument()
    })

    it('複数のファイルを取り込んでいるときは、「ファイル」列も並び替えられる', async () => {
      renderScreen()
      await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
      expect(within(screen.getByRole('columnheader', { name: 'ファイル' })).getByRole('button')).toBeInTheDocument()
    })
  })

  it('ファイル間の重複行の「取り込む」を押すと、新規として戻せる', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)

    fireEvent.click(rowsOf(/Amazon/)[0].getByRole('button', { name: '取り込む' }))

    expect(rowsOf(/Amazon/)[0].getByLabelText('Amazonのコメント')).toBeInTheDocument()
  })

  it('「取り込む」を押した重複行は、「取り込まない」を押すと重複(対象外)の行に戻り、確定の件数からも外れる', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    fireEvent.click(rowsOf(/Amazon/)[0].getByRole('button', { name: '取り込む' }))
    expect(screen.getByRole('button', { name: /^\d+ \/ 4 件を「普通預金」に確定$/ })).toBeInTheDocument()

    fireEvent.click(rowsOf(/Amazon/)[0].getByRole('button', { name: '取り込まない' }))

    const duplicate = rowsOf(/Amazon/)[0]
    expect(duplicate.getByText('ファイル「oct.csv」の同じ明細と重複のため対象外です')).toBeInTheDocument()
    expect(duplicate.queryByRole('button', { name: '取り込まない' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^\d+ \/ 3 件を「普通預金」に確定$/ })).toBeInTheDocument()
  })

  it('別の形式のファイルが混ざっていても、そのファイルだけを「取り込めなかったファイル」に理由つきで出し、残りを取り込める', async () => {
    renderScreen()

    await chooseCsvs([OCT, { name: 'other.csv', body: 'x,y\n1,2\n' }], /oct\.csv を読み込み済み/)

    const panel = within(screen.getByRole('region', { name: '取り込めなかったファイル(1件)' }))
    expect(panel.getByText('other.csv')).toBeInTheDocument()
    expect(panel.getByText('マッピング「マイ銀行」では読み取れません(列「日付」が見つかりません)')).toBeInTheDocument()
    expect(rowOf(/コンビニ/)).toBeDefined()
    expect(screen.queryByRole('checkbox', { name: 'other.csvを取り込む' })).not.toBeInTheDocument()
  })

  it('確定すると、全ファイルの新規の行が仕訳になり、ファイル間の重複行は仕訳にならない', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    for (const text of [/コンビニ/, /書店/]) pick(rowOf(text), '相手科目', '食費')
    pick(rowsOf(/Amazon/)[1], '相手科目', '食費')

    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 3 件を「普通預金」に確定$/ }))

    await screen.findByText(/確定しました/)
    expect(entries.findAll().filter((e) => e.sourceType === 'external_import')).toHaveLength(3)
  })

  it('ファイル間の重複行を「取り込む」にして確定しても、外部取引IDが衝突せずに確定できる', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    fireEvent.click(rowsOf(/Amazon/)[0].getByRole('button', { name: '取り込む' }))
    for (const text of [/コンビニ/, /書店/]) pick(rowOf(text), '相手科目', '食費')
    pick(rowsOf(/Amazon/)[0], '相手科目', '食費')
    pick(rowsOf(/Amazon/)[1], '相手科目', '食費')

    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 4 件を「普通預金」に確定$/ }))

    await screen.findByText(/確定しました/)
    expect(entries.findAll().filter((e) => e.sourceType === 'external_import')).toHaveLength(4)
  })

  it('取込済みの行には「取り込み済みの仕訳を見る」が出て、画面を離れずに既存の仕訳の内容を確認できる', async () => {
    renderScreen()
    await chooseCsvs([SEP], /sep\.csv を読み込み済み/)
    pick(rowOf(/Spotify/), '相手科目', '食費')
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)

    await chooseCsvs([SEP, OCT], /2ファイルを読み込み済み/)

    const row = rowOf(/Spotify/)
    expect(row.getByText('取り込み済みのため対象外です')).toBeInTheDocument()
    fireEvent.click(row.getByText('取り込み済みの仕訳を見る'))
    expect(await row.findByText(/仕訳 #\d+ ・ 2025\/09\/05 ・ Spotify ・ -¥980/)).toBeInTheDocument()
  })

  it('「取り込まない行」には、どのファイルの何行目かが出る', async () => {
    renderScreen()
    const withNote = { name: 'oct.csv', body: `${OCT.body},為替レート 148.5,\n` }

    await chooseCsvs([withNote, NOV], /2ファイルを読み込み済み/)

    const panel = within(screen.getByRole('region', { name: '取り込まない行(1件)' }))
    expect(panel.getByText('oct.csv ・ 4行目')).toBeInTheDocument()
  })

  it('1ファイルだけ選んだときは、「ファイル」列もファイルの一覧も出ない(従来の画面のまま)', async () => {
    renderScreen()

    await chooseCsvs([OCT], /oct\.csv を読み込み済み。新規 2 件、重複で除外 0 件、確認が必要 2 件/)

    const headers = within(screen.getByRole('table', { name: '明細の一覧' })).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).not.toContain('ファイル')
    expect(screen.queryByRole('list', { name: '取り込むCSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /取り込めなかったファイル/ })).not.toBeInTheDocument()
    await waitFor(() => expect(findMemberButton('誰の明細か(必須)')).toBeInTheDocument())
  })
})

describe('StatementImportScreen: 開いた直後の開始状態(計画Issue #214・#231)', () => {
  it('仕訳画面の「明細から起票」から開いた直後は、CSVを読み込まず、「CSVを選択」の開始状態を出す(CSVはこの画面で選ぶ)', async () => {
    renderScreen()

    expect(await screen.findByRole('region', { name: 'CSVの選択' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'CSVを選択' }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/読み込み済み/)).not.toBeInTheDocument()
  })
})

describe('StatementImportScreen: 複数CSVの残高照合(計画Issue #214)', () => {
  const HEADER_B = '日付,摘要,金額,残高\n'
  const withBalance = (name: string, rows: string[]) => ({ name, body: HEADER_B + rows.map((r) => r + '\n').join('') })

  beforeEach(() => {
    // 残高の列がある定義にする(取込先の普通預金は残高の照合対象)
    const repo = new SqlJsImportMappingDefinitionRepository(db)
    repo.update(repo.findAll()[0].id, { balanceColumn: '残高' })
  })

  it('期間が空く複数ファイルでも、選んだ順に関係なく日付順に残高をつなげ、合っていれば「一致している」と出す', async () => {
    renderScreen()
    const sep = withBalance('sep.csv', ['2025/09/05,Spotify,-980,99020'])
    const oct = withBalance('oct.csv', ['2025/10/03,コンビニ,-420,98600', '2025/10/26,Amazon,-2980,95620'])

    await chooseCsvs([oct, sep], /2ファイルを読み込み済み/)

    expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
  })

  it('ファイルの境目で残高が合わないときは、そのずれた期間を示す', async () => {
    renderScreen()
    const sep = withBalance('sep.csv', ['2025/09/05,Spotify,-980,99020'])
    // 10/03の98600まではつながるが、10/26は95620のはずが90000(ずれ)
    const oct = withBalance('oct.csv', ['2025/10/03,コンビニ,-420,98600', '2025/10/26,Amazon,-2980,90000'])

    await chooseCsvs([sep, oct], /2ファイルを読み込み済み/)

    expect(await screen.findByText(/帳簿と明細の残高が合わない期間があります/)).toBeInTheDocument()
    expect(screen.getByText(/2025-10-04〜2025-10-26/)).toBeInTheDocument()
  })

  it('期間が重なるファイルでは、ファイル間の重複行を残高の照合から除き、二重に数えて崩れない', async () => {
    renderScreen()
    const oct = withBalance('oct.csv', ['2025/10/03,コンビニ,-420,99580', '2025/10/26,Amazon,-2980,96600'])
    const nov = withBalance('nov.csv', ['2025/10/26,Amazon,-2980,96600', '2025/11/03,書店,-1500,95100'])

    await chooseCsvs([oct, nov], /2ファイルを読み込み済み/)

    expect(await screen.findByText(/帳簿と明細の残高は一致しています/)).toBeInTheDocument()
  })
})

describe('StatementImportScreen: 複数CSVの未保存の警告(計画Issue #214)', () => {
  const dialog = () => screen.queryByRole('dialog', { name: '未保存の変更があります' })
  const novCheckbox = () => screen.getByRole('checkbox', { name: 'nov.csvを取り込む' })

  it('入力を変えていないときは、ファイルのチェックを外しても警告を出さずに作り直す', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)

    fireEvent.click(novCheckbox())

    expect(dialog()).not.toBeInTheDocument()
    await screen.findByText(/oct\.csv を読み込み済み/)
  })

  it('行を編集した状態でファイルのチェックを外しても警告を出さず、残ったファイルの行の編集内容は保たれる', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    pick(rowOf(/コンビニ/), '相手科目', '食費')

    fireEvent.click(novCheckbox())

    expect(dialog()).not.toBeInTheDocument()
    await screen.findByText(/oct\.csv を読み込み済み/)
    expect(novCheckbox()).not.toBeChecked()
    expect(screen.queryByText('書店')).not.toBeInTheDocument()
    expect(rowOf(/コンビニ/).getByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
  })

  it('外したファイルのチェックを戻すと、そのファイルの行の編集内容も元に戻る', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    pick(rowOf(/書店/), '相手科目', '食費')

    fireEvent.click(novCheckbox())
    await screen.findByText(/oct\.csv を読み込み済み/)
    fireEvent.click(novCheckbox())

    await screen.findByText(/2ファイルを読み込み済み/)
    expect(rowOf(/書店/).getByRole('button', { name: /^相手科目: 食費/ })).toBeInTheDocument()
  })

  it('行を編集した状態で新しいCSVを選び直そうとしても警告が出る(複数ファイルの取込中)', async () => {
    renderScreen()
    await chooseCsvs([OCT, NOV], /2ファイルを読み込み済み/)
    pick(rowOf(/コンビニ/), '相手科目', '食費')

    fireEvent.click(screen.getByRole('button', { name: 'CSVを選択' }))

    expect(dialog()).toBeInTheDocument()
  })
})
