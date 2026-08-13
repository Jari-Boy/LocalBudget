// @vitest-environment jsdom
/**
 * 世帯メンバー管理画面(計画Issue #37)の削除・非アクティブ化のコンポーネントテスト。
 * docs/domain/household-members.md 1.3節の通り、口座(accounts.household_member_id)・
 * 仕訳明細(journal_lines.household_member_id)いずれにも紐づかないメンバーは物理削除、
 * 一方でも紐づく場合は非アクティブ化のみ可能であることを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { HouseholdMemberManagementScreen } from './HouseholdMemberManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <HouseholdMemberManagementScreen
        householdMemberRepository={householdMemberRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('HouseholdMemberManagementScreen 削除・非アクティブ化', () => {
  it('紐づく口座・仕訳明細が0件のメンバーは削除ボタンで一覧から消える', async () => {
    householdMemberRepository.create({ name: '夫' })

    renderScreen()

    const item = (await screen.findByText('夫')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '削除' }))

    expect(await screen.findByText('登録済みの世帯メンバーがいません')).toBeInTheDocument()
    expect(householdMemberRepository.findAll()).toHaveLength(0)
  })

  it('口座の名義になっているメンバーには削除ボタンが表示されない', async () => {
    const member = householdMemberRepository.create({ name: '夫' })
    accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true, householdMemberId: member.id })

    renderScreen()

    const item = (await screen.findByText('夫')).closest('li')!
    expect(within(item).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
    expect(within(item).getByRole('button', { name: '非アクティブ化' })).toBeInTheDocument()
  })

  it('仕訳明細で参照されているメンバーには削除ボタンが表示されない', async () => {
    const member = householdMemberRepository.create({ name: '妻' })
    const expenseAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cashAccount = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    journalEntryRepository.create({
      entryDate: '2026-08-11',
      householdMemberId: member.id,
      lines: [
        { accountId: expenseAccount.id, side: 'debit', amount: 1000, householdMemberId: member.id },
        { accountId: cashAccount.id, side: 'credit', amount: 1000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('妻')).closest('li')!
    expect(within(item).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('紐づく参照が0件のメンバーにも非アクティブ化ボタンが表示され、押すと一覧上で非アクティブと判別できる', async () => {
    householdMemberRepository.create({ name: '夫' })

    renderScreen()

    const item = (await screen.findByText('夫')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '非アクティブ化' }))

    const updatedItem = (await screen.findByText('夫')).closest('li')!
    expect(updatedItem).toHaveTextContent('非アクティブ')
  })

  it('既に非アクティブ化されたメンバーには非アクティブ化ボタンが表示されない', async () => {
    const member = householdMemberRepository.create({ name: '夫' })
    householdMemberRepository.deactivate(member.id)

    renderScreen()

    const item = (await screen.findByText('夫')).closest('li')!
    expect(within(item).queryByRole('button', { name: '非アクティブ化' })).not.toBeInTheDocument()
  })
})
