// @vitest-environment jsdom
/**
 * 世帯メンバー管理画面(計画Issue #37)のグループ機能のコンポーネントテスト。
 * docs/domain/household-members.md 1.5節が定めるグループの所属メンバー追加・除去、
 * および同節の制約(グループのネスト禁止・作成後のisGroup変更禁止)がDDLトリガー
 * (docs/schema/household_members.sql)経由で拒否された際、UIが選択肢から機械的に
 * 排除するのではなく、Repository層が投げる例外を捕捉してエラー表示することを
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
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

describe('HouseholdMemberManagementScreen グループ所属メンバー管理', () => {
  it('グループに個人メンバーを追加すると所属メンバー一覧に表示される', async () => {
    householdMemberRepository.create({ name: '夫' })
    householdMemberRepository.create({ name: '夫婦', isGroup: true })

    renderScreen()

    const groupItem = (await screen.findByText('夫婦')).closest('li')!
    fireEvent.click(within(groupItem).getByRole('button', { name: '所属メンバー: 0人' }))

    fireEvent.change(within(groupItem).getByLabelText('追加するメンバー'), {
      target: { value: String(householdMemberRepository.findAll().find((m) => m.name === '夫')!.id) },
    })
    fireEvent.click(within(groupItem).getByRole('button', { name: '追加' }))

    await waitFor(() => expect(within(groupItem).getByText('夫')).toBeInTheDocument())
  })

  it('既にグループに所属しているメンバーは追加候補のセレクトに表示されない', async () => {
    const husband = householdMemberRepository.create({ name: '夫' })
    householdMemberRepository.create({ name: '妻' })
    const couple = householdMemberRepository.create({ name: '夫婦', isGroup: true })
    householdMemberRepository.addGroupMember(couple.id, husband.id)

    renderScreen()

    const groupItem = (await screen.findByText('夫婦')).closest('li')!
    fireEvent.click(within(groupItem).getByRole('button', { name: '所属メンバー: 1人' }))
    await within(groupItem).findByText('夫', { selector: '.household-member-group-member-name' })

    const select = within(groupItem).getByLabelText('追加するメンバー')
    expect(within(select).queryByRole('option', { name: '夫' })).not.toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '妻' })).toBeInTheDocument()
  })

  it('グループから所属メンバーを除去できる', async () => {
    const husband = householdMemberRepository.create({ name: '夫' })
    const couple = householdMemberRepository.create({ name: '夫婦', isGroup: true })
    householdMemberRepository.addGroupMember(couple.id, husband.id)

    renderScreen()

    const groupItem = (await screen.findByText('夫婦')).closest('li')!
    fireEvent.click(within(groupItem).getByRole('button', { name: '所属メンバー: 1人' }))
    await within(groupItem).findByText('夫', { selector: '.household-member-group-member-name' })

    fireEvent.click(within(groupItem).getByRole('button', { name: '除去' }))

    await waitFor(() => expect(within(groupItem).getByText('所属メンバーがいません')).toBeInTheDocument())
  })

  it('グループを別のグループの所属メンバーとして追加しようとするとエラーが表示される(ネスト禁止)', async () => {
    householdMemberRepository.create({ name: '内側グループ', isGroup: true })
    householdMemberRepository.create({ name: '外側グループ', isGroup: true })

    renderScreen()

    const outerItem = (await screen.findByText('外側グループ')).closest('li')!
    fireEvent.click(within(outerItem).getByRole('button', { name: '所属メンバー: 0人' }))

    const innerGroupId = householdMemberRepository.findAll().find((m) => m.name === '内側グループ')!.id
    fireEvent.change(within(outerItem).getByLabelText('追加するメンバー'), {
      target: { value: String(innerGroupId) },
    })
    fireEvent.click(within(outerItem).getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '所属メンバーの追加に失敗しました。個人メンバーのみ追加できます。',
    )
  })

  it('編集フォームで種別をグループに変更して保存すると、is_group変更禁止トリガーによりエラーが表示される', async () => {
    householdMemberRepository.create({ name: '夫' })

    renderScreen()

    const item = (await screen.findByText('夫')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.click(screen.getByLabelText('グループ'))
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました。もう一度お試しください。')
    expect(householdMemberRepository.findAll()[0].isGroup).toBe(false)
  })
})
