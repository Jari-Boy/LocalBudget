// @vitest-environment jsdom
/**
 * MemberMasterTab(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の「世帯メンバー」タブ: 名称・種類(個人/グループ)・状態の一覧、個人とグループの追加、
 * 右パネルでの名称の変更、グループの構成メンバーの追加・解除(現行の世帯メンバー管理画面から
 * 引き継ぐ)、有効/無効の切り替え、2回押しの削除と、仕訳・仕訳の起票者・科目の名義・定期取引ルールで
 * 使用中のときの削除不可の理由表示を、sql.jsのNode実装(createTestDatabase)を使って確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsRecurringTransactionRuleRepository } from '../../infrastructure/db/SqlJsRecurringTransactionRuleRepository'
import { MemberMasterTab } from './MemberMasterTab'
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

let db: Database
let members: SqlJsHouseholdMemberRepository
let accounts: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  members = new SqlJsHouseholdMemberRepository(db)
  accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <MemberMasterTab
        householdMemberRepository={members}
        accountRepository={accounts}
        journalEntryRepository={entries}
        recurringTransactionRuleRepository={new SqlJsRecurringTransactionRuleRepository(db)}
      />
    </I18nextProvider>,
  )
}

const panel = () => within(screen.getByRole('region', { name: '世帯メンバーの編集' }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

/** メンバーを起票者にした仕訳を1件登録する */
function postEntry(authorId: number, lineMemberId = 1) {
  const expense = accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
  const cash = accounts.create({ category: 'asset', name: '現金', isReconcilable: false })
  entries.create({
    entryDate: '2026-11-01',
    householdMemberId: authorId,
    lines: [
      { accountId: expense.id, side: 'debit', amount: 1000, householdMemberId: lineMemberId },
      { householdMemberId: 1, accountId: cash.id, side: 'credit', amount: 1000 },
    ],
  })
  return { expense, cash }
}

describe('MemberMasterTab', () => {
  it('名称・種類・状態の一覧が表示され、グループの種類には構成メンバーが出る', async () => {
    const husband = members.create({ name: '夫' })
    const wife = members.create({ name: '妻' })
    const couple = members.create({ name: '夫婦', isGroup: true })
    members.addGroupMember(couple.id, husband.id)
    members.addGroupMember(couple.id, wife.id)

    renderTab()

    const row = (await screen.findByRole('button', { name: '夫婦' })).closest('tr')!
    expect(within(row).getByText('グループ(夫・妻)')).toBeInTheDocument()
    const personRow = screen.getByRole('button', { name: '夫' }).closest('tr')!
    expect(within(personRow).getByText('個人')).toBeInTheDocument()
    expect(within(personRow).getByText('有効')).toBeInTheDocument()
  })

  it('「世帯メンバーを追加」で個人が、「グループを追加」でグループが作られ、編集パネルが開く', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: '世帯メンバーを追加' }))
    await waitFor(() => expect(members.findAll()).toHaveLength(1))
    expect(members.findAll()[0].isGroup).toBe(false)
    expect(await screen.findByRole('region', { name: '世帯メンバーの編集' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))
    await waitFor(() => expect(members.findAll()).toHaveLength(2))
    expect(members.findAll()[1].isGroup).toBe(true)
  })

  it('名称を変えて保存すると、DBに反映される', async () => {
    const husband = members.create({ name: '夫' })
    renderTab()
    await open('夫')

    fireEvent.change(panel().getByLabelText('名称'), { target: { value: 'お父さん' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(members.findById(husband.id)!.name).toBe('お父さん'))
  })

  it('グループの構成メンバーは、チェックで追加・解除でき、すぐにDBへ反映される', async () => {
    const husband = members.create({ name: '夫' })
    members.create({ name: '妻' })
    const couple = members.create({ name: '夫婦', isGroup: true })
    renderTab()
    await open('夫婦')

    fireEvent.click(panel().getByRole('checkbox', { name: '夫' }))
    await waitFor(() => expect(members.findGroupMembers(couple.id).map((m) => m.id)).toEqual([husband.id]))

    fireEvent.click(panel().getByRole('checkbox', { name: '夫' }))
    await waitFor(() => expect(members.findGroupMembers(couple.id)).toHaveLength(0))
  })

  it('個人の編集パネルには、構成メンバーの欄が出ない', async () => {
    members.create({ name: '夫' })
    renderTab()
    await open('夫')

    expect(panel().queryByText('構成メンバー')).not.toBeInTheDocument()
  })

  it('「無効にする」と、DBで無効になり、「有効にする」で戻る', async () => {
    const husband = members.create({ name: '夫' })
    renderTab()
    await open('夫')

    fireEvent.click(panel().getByRole('button', { name: '無効にする' }))
    await waitFor(() => expect(members.findById(husband.id)!.isActive).toBe(false))

    fireEvent.click(await panel().findByRole('button', { name: '有効にする' }))
    await waitFor(() => expect(members.findById(husband.id)!.isActive).toBe(true))
  })

  it('使われていないメンバーは、「削除」を2回押すと削除される', async () => {
    const husband = members.create({ name: '夫' })
    renderTab()
    await open('夫')

    fireEvent.click(panel().getByRole('button', { name: '削除' }))
    expect(members.findById(husband.id)).not.toBeNull()
    fireEvent.click(panel().getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(members.findById(husband.id)).toBeNull())
  })

  it('仕訳の起票者になっているメンバーは、削除できず理由が表示される', async () => {
    const husband = members.create({ name: '夫' })
    postEntry(husband.id)
    renderTab()
    await open('夫')

    expect(panel().getByRole('button', { name: '削除' })).toBeDisabled()
    expect(panel().getByText(/仕訳の起票者1件で使用中のため削除できません/)).toBeInTheDocument()
  })

  it('仕訳の明細・科目の名義・定期取引ルールで使用中の理由も表示される', async () => {
    const author = members.create({ name: '妻' })
    const husband = members.create({ name: '夫' })
    const { expense, cash } = postEntry(author.id, husband.id)
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true, householdMemberId: husband.id })
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '家賃',
      lines: twoLineRuleLines(expense.id, cash.id, 1000),
      frequency: 'monthly',
      dayOfMonth: 1,
      bookkeeperHouseholdMemberId: husband.id,
    })
    renderTab()
    await open('夫')

    expect(panel().getByText(/仕訳の明細1行/)).toBeInTheDocument()
    expect(panel().getByText(/科目の名義1件/)).toBeInTheDocument()
    expect(panel().getByText(/定期取引ルール1件/)).toBeInTheDocument()
  })
})
