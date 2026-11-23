// @vitest-environment jsdom
/**
 * 左上の追加ボタンでの親グループの自動入力(計画Issue #257)のコンポーネントテスト。
 * ProjectMasterTab経由で、共通部品(GroupedMasterTab)の「グループを追加」「プロジェクトを追加」が、
 * 選んでいる行(グループ=その直下、項目=その兄弟、未選択=最上位)から親を決めること、チェック中でも
 * 基準は最後に選んだ行だけであること、追加後にチェックが外れて新しい行の編集パネルが開くことを、
 * sql.jsのNode実装(createTestDatabase)で確認する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { UnsavedGuardHarness } from './UnsavedGuardHarness'
import { ProjectMasterTab } from './ProjectMasterTab'

let db: Database
let projects: SqlJsProjectRepository
let groups: SqlJsProjectGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  projects = new SqlJsProjectRepository(db)
  groups = new SqlJsProjectGroupRepository(db)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <ProjectMasterTab
          accountRepository={new SqlJsAccountRepository(db)}
          projectRepository={projects}
          projectGroupRepository={groups}
          journalEntryRepository={new SqlJsJournalEntryRepository(db)}
          recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
        />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('左上の追加ボタンでの親グループの自動入力', () => {
  it('何も選んでいないときの「グループを追加」「プロジェクトを追加」は、従来どおり最上位に作られる', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'グループを追加' }))
    await waitFor(() => expect(groups.findAll()).toHaveLength(1))
    expect(groups.findAll()[0].parentGroupId).toBeNull()
  })

  it('グループを選んで「グループを追加」を押すと、そのグループの直下に子グループが作られる', async () => {
    const travel = groups.create({ name: '旅行' })
    renderTab()
    await open('旅行')

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))

    await waitFor(() => expect(groups.findAll()).toHaveLength(2))
    const child = groups.findAll().find((g) => g.id !== travel.id)!
    expect(child.parentGroupId).toBe(travel.id)
    expect(await screen.findByRole('region', { name: 'グループの編集' })).toBeInTheDocument()
  })

  it('グループを選んで「プロジェクトを追加」を押すと、そのグループに所属したプロジェクトが作られ、所属グループ欄に入る', async () => {
    const travel = groups.create({ name: '旅行' })
    renderTab()
    await open('旅行')

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))

    await waitFor(() => expect(projects.findAll()).toHaveLength(1))
    expect(projects.findAll()[0].projectGroupId).toBe(travel.id)
    const editor = within(await screen.findByRole('region', { name: 'プロジェクトの編集' }))
    expect(editor.getByRole('button', { name: '所属グループ: 旅行' })).toBeInTheDocument()
  })

  it('プロジェクトを選んで追加すると、選んだプロジェクトと同じグループ(兄弟)に作られる', async () => {
    const travel = groups.create({ name: '旅行' })
    projects.create({ name: '沖縄旅行', projectGroupId: travel.id })
    renderTab()
    await open('沖縄旅行')

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))

    await waitFor(() => expect(projects.findAll()).toHaveLength(2))
    expect(projects.findAll().every((p) => p.projectGroupId === travel.id)).toBe(true)
  })

  it('グループに属さない最上位のプロジェクトを選んで追加すると、最上位に作られる', async () => {
    projects.create({ name: '単独' })
    renderTab()
    await open('単独')

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))

    await waitFor(() => expect(groups.findAll()).toHaveLength(1))
    expect(groups.findAll()[0].parentGroupId).toBeNull()
  })

  it('2件以上チェック中に追加しても、基準は最後に選んだ行だけで、追加後にチェックが外れ新しい行の編集パネルが開く', async () => {
    const travel = groups.create({ name: '旅行' })
    const home = groups.create({ name: '住まい' })
    projects.create({ name: '沖縄旅行', projectGroupId: travel.id })
    renderTab()
    await open('旅行')
    fireEvent.click(screen.getByRole('checkbox', { name: /^住まい/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^沖縄旅行/ }))
    expect(screen.getByRole('region', { name: '一括操作' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))

    await waitFor(() => expect(groups.findAll()).toHaveLength(3))
    const created = groups.findAll().find((g) => g.id !== travel.id && g.id !== home.id)!
    expect(created.parentGroupId).toBe(travel.id)
    expect(await screen.findByRole('region', { name: 'グループの編集' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '一括操作' })).not.toBeInTheDocument()
  })
})
