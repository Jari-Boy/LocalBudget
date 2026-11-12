// @vitest-environment jsdom
/**
 * ProjectMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「プロジェクト」タブ: グループと項目のツリー表示、右パネルでの名称・所属グループ・
 * 並び順の編集、グループ・プロジェクトの新設、有効/無効の切り替え、2回押しの削除と、
 * 仕訳・定期仕訳ルールで使用中のときの削除不可の理由表示を、sql.jsのNode実装
 * (createTestDatabase)を使って確認する。ツリー表の共通部分(GroupedMasterTab)の挙動も
 * このタブ経由で検証する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { ProjectMasterTab } from './ProjectMasterTab'

let db: Database
let projects: SqlJsProjectRepository
let groups: SqlJsProjectGroupRepository
let expenseId: number
let cashId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  projects = new SqlJsProjectRepository(db)
  groups = new SqlJsProjectGroupRepository(db)
  const accounts = new SqlJsAccountRepository(db)
  expenseId = accounts.create({ category: 'expense', name: '交際費', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <ProjectMasterTab
        accountRepository={new SqlJsAccountRepository(db)}
        projectRepository={projects}
        projectGroupRepository={groups}
        journalEntryRepository={new SqlJsJournalEntryRepository(db)}
        recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
      />
    </I18nextProvider>,
  )
}

const panel = (name: string) => within(screen.getByRole('region', { name }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('ProjectMasterTab', () => {
  it('「すべてのプロジェクト」の見出しの下に、グループとプロジェクトがツリーで表示される', async () => {
    const group = groups.create({ name: '旅行' })
    projects.create({ name: '沖縄旅行', projectGroupId: group.id })

    renderTab()

    expect(await screen.findByText('すべてのプロジェクト')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '旅行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '沖縄旅行' })).toBeInTheDocument()
  })

  it('プロジェクトを選ぶと、右パネルに名称と所属グループが表示され、名称を保存できる', async () => {
    const group = groups.create({ name: '旅行' })
    const project = projects.create({ name: '沖縄旅行', projectGroupId: group.id })
    renderTab()
    await open('沖縄旅行')

    const editor = panel('プロジェクトの編集')
    expect(editor.getByLabelText('所属グループ')).toHaveDisplayValue('旅行')
    fireEvent.change(editor.getByLabelText('名称'), { target: { value: '沖縄家族旅行' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(projects.findById(project.id)!.name).toBe('沖縄家族旅行'))
  })

  it('所属グループを選び直すと、すぐに別のグループへ移る', async () => {
    const travel = groups.create({ name: '旅行' })
    const home = groups.create({ name: '住まい' })
    const project = projects.create({ name: '引っ越し', projectGroupId: travel.id })
    renderTab()
    await open('引っ越し')

    fireEvent.change(panel('プロジェクトの編集').getByLabelText('所属グループ'), { target: { value: `g:${home.id}` } })

    await waitFor(() => expect(projects.findById(project.id)!.projectGroupId).toBe(home.id))
  })

  it('「下へ」で並び順が入れ替わる', async () => {
    const first = projects.create({ name: 'A', sortOrder: 0 })
    const second = projects.create({ name: 'B', sortOrder: 1 })
    renderTab()
    await open('A')

    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '下へ' }))

    await waitFor(() => expect(projects.findById(first.id)!.sortOrder).toBe(1))
    expect(projects.findById(second.id)!.sortOrder).toBe(0)
  })

  it('「グループを追加」でグループが、「プロジェクトを追加」でプロジェクトが作られ、編集パネルが開く', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'グループを追加' }))
    expect(await screen.findByRole('region', { name: 'グループの編集' })).toBeInTheDocument()
    expect(groups.findAll()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    expect(await screen.findByRole('region', { name: 'プロジェクトの編集' })).toBeInTheDocument()
    expect(projects.findAll()).toHaveLength(1)
  })

  it('「プロジェクトを追加」を続けて押しても、同名で失敗せず、名前が重ならない', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'プロジェクトを追加' }))
    await waitFor(() => expect(projects.findAll()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを追加' }))
    await waitFor(() => expect(projects.findAll()).toHaveLength(2))

    expect(new Set(projects.findAll().map((p) => p.name)).size).toBe(2)
  })

  it('使われていないプロジェクトは、「削除」を2回押すと削除される', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    renderTab()
    await open('沖縄旅行')

    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '削除' }))
    expect(projects.findById(project.id)).not.toBeNull()
    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(projects.findById(project.id)).toBeNull())
  })

  it('仕訳で使用中のプロジェクトは、削除ボタンが押せず、理由が表示される', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-11-01',
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 1000, projectId: project.id },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 1000 },
      ],
    })
    renderTab()
    await open('沖縄旅行')

    const editor = panel('プロジェクトの編集')

    expect(editor.getByRole('button', { name: '削除' })).toBeDisabled()
    expect(editor.getByText(/仕訳の明細1行で使用中のため削除できません/)).toBeInTheDocument()
  })

  it('定期仕訳ルールで使用中のプロジェクトも、削除できず理由が表示される', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '積立',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 1000, projectId: project.id },
        { side: 'credit', accountId: cashId, amount: 1000 },
      ],
      frequency: 'monthly',
      dayOfMonth: 1,
    })
    renderTab()
    await open('沖縄旅行')

    expect(panel('プロジェクトの編集').getByText(/定期仕訳ルール1件で使用中/)).toBeInTheDocument()
  })

  it('右パネルに、プロジェクトに紐づく区分別の科目残高の内訳が表示される(旧画面の「内訳を表示」を引き継ぐ)', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    new SqlJsJournalEntryRepository(db).create({
      entryDate: '2026-07-15',
      householdMemberId: memberId,
      lines: [
        { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 5000, projectId: project.id },
        { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 5000 },
      ],
    })
    renderTab()
    await open('沖縄旅行')

    const breakdown = panel('プロジェクトの編集').getByRole('region', { name: '科目残高の内訳' })

    expect(within(breakdown).getByText('交際費')).toBeInTheDocument()
    expect(within(breakdown).getByText('￥5,000')).toBeInTheDocument()
  })

  it('紐づく残高が1件もないプロジェクトは、内訳に空状態のメッセージが出る', async () => {
    projects.create({ name: '計画中の旅行' })
    renderTab()
    await open('計画中の旅行')

    expect(panel('プロジェクトの編集').getByText('残高のある科目がありません')).toBeInTheDocument()
  })

  it('削除の完了を待つ間は、「本当に削除する」を連打しても削除は1回だけ実行される', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    let calls = 0
    const release: Array<() => void> = []
    const slow = {
      findAll: () => projects.findAll(),
      create: projects.create.bind(projects),
      update: projects.update.bind(projects),
      deactivate: projects.deactivate.bind(projects),
      activate: projects.activate.bind(projects),
      delete: (id: number) => {
        calls += 1
        return new Promise<void>((resolve) => release.push(() => resolve(projects.delete(id))))
      },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <ProjectMasterTab
          accountRepository={new SqlJsAccountRepository(db)}
          projectRepository={slow}
          projectGroupRepository={groups}
          journalEntryRepository={new SqlJsJournalEntryRepository(db)}
          recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
        />
      </I18nextProvider>,
    )
    await open('沖縄旅行')
    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '削除' }))

    const confirm = panel('プロジェクトの編集').getByRole('button', { name: '本当に削除する' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(calls).toBe(1)
    expect(confirm).toBeDisabled()
    release.forEach((r) => r())
    await waitFor(() => expect(projects.findById(project.id)).toBeNull())
  })

  it('削除に失敗したときは、エラーを表示する', async () => {
    projects.create({ name: '沖縄旅行' })
    const failing = {
      findAll: () => projects.findAll(),
      create: projects.create.bind(projects),
      update: projects.update.bind(projects),
      deactivate: projects.deactivate.bind(projects),
      activate: projects.activate.bind(projects),
      delete: () => {
        throw new Error('constraint')
      },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <ProjectMasterTab
          accountRepository={new SqlJsAccountRepository(db)}
          projectRepository={failing}
          projectGroupRepository={groups}
          journalEntryRepository={new SqlJsJournalEntryRepository(db)}
          recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
        />
      </I18nextProvider>,
    )
    await open('沖縄旅行')
    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '削除' }))
    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '本当に削除する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('削除に失敗しました')
  })

  it('プロジェクトを「無効にする」と、DBで無効になり、「有効にする」で戻る', async () => {
    const project = projects.create({ name: '沖縄旅行' })
    renderTab()
    await open('沖縄旅行')

    fireEvent.click(panel('プロジェクトの編集').getByRole('button', { name: '無効にする' }))
    await waitFor(() => expect(projects.findById(project.id)!.isActive).toBe(false))

    fireEvent.click(await panel('プロジェクトの編集').findByRole('button', { name: '有効にする' }))
    await waitFor(() => expect(projects.findById(project.id)!.isActive).toBe(true))
  })

  it('中にプロジェクトがあるグループは削除できず、空のグループは2回押しで削除される', async () => {
    const full = groups.create({ name: '旅行' })
    projects.create({ name: '沖縄旅行', projectGroupId: full.id })
    const empty = groups.create({ name: '空' })
    renderTab()

    await open('旅行')
    expect(panel('グループの編集').getByRole('button', { name: 'グループを削除' })).toBeDisabled()

    await open('空')
    fireEvent.click(panel('グループの編集').getByRole('button', { name: 'グループを削除' }))
    fireEvent.click(panel('グループの編集').getByRole('button', { name: '本当に削除する' }))
    await waitFor(() => expect(groups.findById(empty.id)).toBeNull())
  })
})
