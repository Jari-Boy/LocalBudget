// @vitest-environment jsdom
/**
 * 詳細パネルのキャンセルとEscキー(計画Issue #237)のコンポーネントテスト。ProjectMasterTab(共通のGroupedMasterTabの右パネル)で、
 * 「キャンセル」が変更の無い間は押せず、名称を書き換えると押せて、押すと確認なしで保存済みの値に戻すこと、
 * Escは変更があるときだけ「変更を破棄しますか?」を出し、「破棄する」で戻し、「編集を続ける」では入力が残ることを、
 * sql.jsのNode実装(createTestDatabase)で確認する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UnsavedGuardHarness } from './UnsavedGuardHarness'
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

const panel = (name: string) => within(screen.getByRole('region', { name }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('ProjectMasterTab 詳細パネルのキャンセル(計画Issue #237)', () => {
  const editor = () => panel('プロジェクトの編集')
  const nameInput = () => editor().getByLabelText('名称')

  async function openOkinawa() {
    projects.create({ name: '沖縄', projectGroupId: null })
    renderTab()
    await open('沖縄')
  }

  it('変更が無い間は、「キャンセル」が押せない', async () => {
    await openOkinawa()

    expect(editor().getByRole('button', { name: 'キャンセル' })).toBeDisabled()
  })

  it('名称を書き換えると「キャンセル」が押せ、押すと確認なしで保存済みの名称に戻る', async () => {
    await openOkinawa()
    fireEvent.change(nameInput(), { target: { value: '沖縄家族旅行' } })

    fireEvent.click(editor().getByRole('button', { name: 'キャンセル' }))

    expect(nameInput()).toHaveValue('沖縄')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(editor().getByRole('button', { name: 'キャンセル' })).toBeDisabled()
  })

  it('キャンセルしても右パネルは閉じず、保存はされない', async () => {
    await openOkinawa()
    fireEvent.change(nameInput(), { target: { value: '沖縄家族旅行' } })
    fireEvent.click(editor().getByRole('button', { name: 'キャンセル' }))

    expect(screen.getByRole('region', { name: 'プロジェクトの編集' })).toBeInTheDocument()
    expect(projects.findAll().map((p) => p.name)).toEqual(['沖縄'])
  })

  it('変更があるときのEscは「変更を破棄しますか?」を出し、「破棄する」で保存済みの名称に戻る', async () => {
    await openOkinawa()
    fireEvent.change(nameInput(), { target: { value: '沖縄家族旅行' } })

    fireEvent.keyDown(nameInput(), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '変更を破棄しますか?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '破棄する' }))

    expect(nameInput()).toHaveValue('沖縄')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('確認で「編集を続ける」を選ぶと、入力した名称が残る', async () => {
    await openOkinawa()
    fireEvent.change(nameInput(), { target: { value: '沖縄家族旅行' } })
    fireEvent.keyDown(nameInput(), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))

    expect(nameInput()).toHaveValue('沖縄家族旅行')
  })

  it('変更が無いときのEscは、何も出さない', async () => {
    await openOkinawa()

    fireEvent.keyDown(nameInput(), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
