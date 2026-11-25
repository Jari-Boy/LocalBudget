// @vitest-environment jsdom
/**
 * StatementImportScreen の摘要のウェブ検索リンク(計画Issue #283)のコンポーネントテスト。
 * 各行の摘要の右に虫眼鏡のリンクが出て、Googleの検索URLを新しいタブ(noopener noreferrer)で開くこと、
 * アイコンが全行(重複の行を含む)に出ること、支援技術から名前で取得できること、
 * 押しても行の選択が変わらないこと、画面が自動では検索(遷移・window.open)しないことを確認する。
 * 縦にそろった位置(摘要セルの右端)に置くことは、セルの構造(摘要の文字と同じ入れ物の中の、リンクが最後の要素)で確認する
 * (見た目そのものは実機で確認する)。
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
let bank: ReturnType<SqlJsAccountRepository['create']>

beforeEach(async () => {
  localStorage.clear()
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  accounts = new SqlJsAccountRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '自分' })
  bank = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true })
  accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  new SqlJsImportMappingDefinitionRepository(db).create({
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderScreen() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <StatementImportScreen
          accountRepository={accounts}
          accountGroupRepository={new SqlJsAccountGroupRepository(db)}
          importMappingDefinitionRepository={new SqlJsImportMappingDefinitionRepository(db)}
          externalTransactionRefRepository={new SqlJsExternalTransactionRefRepository(db)}
          journalEntryRepository={new SqlJsJournalEntryRepository(db)}
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

const HEADER = '日付,摘要,金額,残高\n'

async function chooseCsv(content: string) {
  fireEvent.change(await screen.findByLabelText('CSVを選択'), {
    target: { files: [new File([content], 'statement.csv', { type: 'text/csv' })] },
  })
  await screen.findByText(/statement\.csv を読み込み済み/)
  if (screen.queryByRole('button', { name: /^誰の明細か\(必須\)/ })) chooseMember('誰の明細か(必須)', '自分')
}

/** 補助行にも同じ摘要が入るため、先頭の行(明細の行)を使う */
const rowOf = (text: string | RegExp) => within(screen.getAllByRole('row', { name: text })[0])
const searchLink = (desc: string) => screen.getByRole('link', { name: `「${desc}」をウェブ検索(新しいタブ)` })

describe('StatementImportScreen 摘要のウェブ検索リンク(計画Issue #283)', () => {
  it('各行の摘要の右に、その摘要をGoogleで検索するリンクが出る', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,FAMILY CLUB web,-3960,96040\n2026/10/06,フルーツパーラー フエルナ,-6754,89286\n`)
    const link = searchLink('FAMILY CLUB web')
    const url = new URL(link.getAttribute('href') ?? '')
    expect(url.origin + url.pathname).toBe('https://www.google.com/search')
    expect(url.searchParams.get('q')).toBe('FAMILY CLUB web')
    expect(new URL(searchLink('フルーツパーラー フエルナ').getAttribute('href') ?? '').searchParams.get('q')).toBe('フルーツパーラー フエルナ')
  })

  it('リンクは新しいタブで開き、noopener と noreferrer を持つ', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    const link = searchLink('スーパー')
    expect(link).toHaveAttribute('target', '_blank')
    const rel = (link.getAttribute('rel') ?? '').split(/\s+/)
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('記号や空白を含む摘要も、検索語が正しくエンコードされる', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,"カ)マーチ & カンパニー=1",-4770,95230\n`)
    const href = searchLink('カ)マーチ & カンパニー=1').getAttribute('href') ?? ''
    expect(new URL(href).searchParams.get('q')).toBe('カ)マーチ & カンパニー=1')
    expect(href).not.toContain(' ')
  })

  it('摘要のリンクは摘要セルの中の最後の要素で、摘要の文字と同じ入れ物に入る(全行で右端にそろう)', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n2026/10/06,ランチ,-800,96200\n`)
    for (const desc of ['スーパー', 'ランチ']) {
      const cell = searchLink(desc).closest('td') as HTMLElement
      expect(cell).toHaveClass('import-desc')
      const box = searchLink(desc).parentElement as HTMLElement
      expect(box).toHaveClass('import-desc-box')
      expect(box.lastElementChild).toBe(searchLink(desc))
      expect(within(box).getByText(desc)).toBeInTheDocument()
    }
  })

  it('重複の行にもリンクが出る', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    fireEvent.click(rowOf(/スーパー/).getByRole('button', { name: /^相手科目/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '相手科目' })).getByRole('button', { name: '食費' }))
    fireEvent.click(screen.getByRole('button', { name: /^\d+ \/ 1 件を「普通預金」に確定$/ }))
    await screen.findByText(/確定しました/)
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)

    fireEvent.click(await screen.findByRole('tab', { name: /^重複/ }))
    expect(await rowOf(/スーパー/).findByText('取り込み済みのため対象外です')).toBeInTheDocument()
    expect(rowOf(/スーパー/).getByRole('link', { name: '「スーパー」をウェブ検索(新しいタブ)' })).toBeInTheDocument()
  })

  it('リンクを(Ctrlを押しながら)押しても、その行のチェックは切り替わらない', async () => {
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    const box = screen.getByLabelText('スーパーを選択') as HTMLInputElement
    fireEvent.click(searchLink('スーパー'), { ctrlKey: true })
    expect(box.checked).toBe(false)
  })

  it('画面を表示しただけでは、検索も遷移もしない(window.open を呼ばない)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderScreen()
    await chooseCsv(`${HEADER}2026/10/05,スーパー,-3000,97000\n`)
    await waitFor(() => expect(searchLink('スーパー')).toBeInTheDocument())
    expect(open).not.toHaveBeenCalled()
    // 先読み(prefetch)を促すlinkタグも作らない
    expect(document.querySelector('link[rel~="prefetch"], link[rel~="preload"], link[rel~="prerender"]')).toBeNull()
  })
})
