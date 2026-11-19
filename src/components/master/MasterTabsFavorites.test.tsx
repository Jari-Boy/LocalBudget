// @vitest-environment jsdom
/**
 * マスタ画面(科目・取引先・プロジェクトの3タブ)のお気に入りの★(計画Issue #231 フェーズ4)のコンポーネントテスト。
 * 項目の行の名称の左に★が出て、押すとお気に入りを付け外しして保存し、開き直しても状態が保たれること(DBのRepositoryを使う)、
 * グループの行には★が出ないこと、システム管理の科目(立替金など)には★が出ない(場所だけ空ける)こと、
 * 無効な項目も★の状態を保つこと、プロバイダーが無いとき(既存のテスト)は★を出さないことを確認する。
 * sql.jsのNode実装(createTestDatabase)を使う。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { seedBalanceAdjustmentAccount } from '../../infrastructure/db/seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { SqlJsAccountBalanceRecordRepository } from '../../infrastructure/db/SqlJsAccountBalanceRecordRepository'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../../infrastructure/db/SqlJsBudgetRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { FavoritesProvider } from '../common/favorites/FavoritesContext'
import { UnsavedGuardHarness } from './UnsavedGuardHarness'
import { AccountMasterTab } from './AccountMasterTab'
import { CounterpartyMasterTab } from './CounterpartyMasterTab'
import { ProjectMasterTab } from './ProjectMasterTab'

let db: Database
let accounts: SqlJsAccountRepository
let counterparties: SqlJsCounterpartyRepository
let projects: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  accounts = new SqlJsAccountRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  projects = new SqlJsProjectRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '夫' })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function withProvider(children: React.ReactNode, enabled = true) {
  return (
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        {enabled ? (
          <FavoritesProvider repositories={{ account: accounts, counterparty: counterparties, project: projects }} refreshKey="a">
            {children}
          </FavoritesProvider>
        ) : (
          children
        )}
      </UnsavedGuardHarness>
    </I18nextProvider>
  )
}

const accountTab = () => (
  <AccountMasterTab
    accountRepository={accounts}
    accountGroupRepository={new SqlJsAccountGroupRepository(db)}
    householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
    journalEntryRepository={new SqlJsJournalEntryRepository(db)}
    budgetRepository={new SqlJsBudgetRepository(db)}
    recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
    importMappingDefinitionRepository={new SqlJsImportMappingDefinitionRepository(db)}
    keywordRuleRepository={new SqlJsKeywordRuleRepository(db)}
    accountBalanceRecordRepository={new SqlJsAccountBalanceRecordRepository(db)}
    today="2026-11-07"
  />
)

const counterpartyTab = () => (
  <CounterpartyMasterTab
    counterpartyRepository={counterparties}
    keywordRuleRepository={new SqlJsKeywordRuleRepository(db)}
    counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
    accountRepository={accounts}
    accountGroupRepository={new SqlJsAccountGroupRepository(db)}
    journalEntryRepository={new SqlJsJournalEntryRepository(db)}
    recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
    settlementBatchRepository={new SqlJsSettlementBatchRepository(db)}
  />
)

const projectTab = () => (
  <ProjectMasterTab
    accountRepository={accounts}
    projectRepository={projects}
    projectGroupRepository={new SqlJsProjectGroupRepository(db)}
    journalEntryRepository={new SqlJsJournalEntryRepository(db)}
    recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
  />
)

describe('マスタ画面: 科目のお気に入り', () => {
  it('科目の行の名称の左に★が出て、押すとお気に入りに追加でき、保存されて、開き直しても残る。もう一度押すと外れる', async () => {
    const food = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    render(withProvider(accountTab()))

    fireEvent.click(await screen.findByRole('button', { name: '食費をお気に入りに追加' }))

    await waitFor(() => expect(accounts.findFavoriteIds()).toEqual([food.id]))
    expect(await screen.findByRole('button', { name: '食費をお気に入りから外す' })).toHaveAttribute('aria-pressed', 'true')

    cleanup()
    render(withProvider(accountTab()))
    fireEvent.click(await screen.findByRole('button', { name: '食費をお気に入りから外す' }))
    await waitFor(() => expect(accounts.findFavoriteIds()).toEqual([]))
  })

  it('グループの行には★を出さない', async () => {
    new SqlJsAccountGroupRepository(db).create({ name: '日常', category: 'expense' })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    render(withProvider(accountTab()))

    await screen.findByRole('button', { name: '食費をお気に入りに追加' })

    expect(screen.queryByRole('button', { name: '日常をお気に入りに追加' })).not.toBeInTheDocument()
  })

  it('システム管理の科目(初期残高・立替金など)には★を出さない', async () => {
    accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    render(withProvider(accountTab()))

    await screen.findByRole('button', { name: '食費をお気に入りに追加' })

    expect(screen.getByRole('button', { name: '立替金' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '立替金をお気に入りに追加' })).not.toBeInTheDocument()
  })

  it('プロバイダーが無いときは、★を出さない(従来の画面のまま)', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    render(withProvider(accountTab(), false))

    await screen.findByRole('button', { name: '食費' })

    expect(screen.queryByRole('button', { name: /お気に入り/ })).not.toBeInTheDocument()
  })
})

describe('マスタ画面: 取引先のお気に入り', () => {
  it('取引先の行の★で付け外しでき、保存されて、開き直しても残る', async () => {
    const shop = counterparties.create({ name: 'スーパー' })
    render(withProvider(counterpartyTab()))

    fireEvent.click(await screen.findByRole('button', { name: 'スーパーをお気に入りに追加' }))

    await waitFor(() => expect(counterparties.findFavoriteIds()).toEqual([shop.id]))
    cleanup()
    render(withProvider(counterpartyTab()))
    expect(await screen.findByRole('button', { name: 'スーパーをお気に入りから外す' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('無効な取引先も、★の状態を保つ', async () => {
    const old = counterparties.create({ name: '旧スーパー' })
    counterparties.setFavorite(old.id, true)
    counterparties.deactivate(old.id)
    render(withProvider(counterpartyTab()))

    expect(await screen.findByRole('button', { name: '旧スーパーをお気に入りから外す' })).toBeInTheDocument()
  })
})

describe('マスタ画面: プロジェクトのお気に入り', () => {
  it('プロジェクトの行の★で付け外しでき、保存されて、開き直しても残る', async () => {
    const trip = projects.create({ name: '沖縄旅行' })
    render(withProvider(projectTab()))

    fireEvent.click(await screen.findByRole('button', { name: '沖縄旅行をお気に入りに追加' }))

    await waitFor(() => expect(projects.findFavoriteIds()).toEqual([trip.id]))
    cleanup()
    render(withProvider(projectTab()))
    expect(await screen.findByRole('button', { name: '沖縄旅行をお気に入りから外す' })).toHaveAttribute('aria-pressed', 'true')
  })
})
