// @vitest-environment jsdom
/**
 * AccountCreateForm の「所属グループ」欄からその場で科目グループを作る機能(計画Issue #290)のコンポーネントテスト。
 * onCreateGroupを渡したときだけ「+ グループを新規追加」を出すこと、親グループ(既定は最上位)を選んで作れること、
 * 親の候補は登録中の区分のグループだけ(区分をまたげない)こと、作ったグループがそのまま所属グループに選ばれることを確認する。
 * 外部依存: sql.js(ネットワークなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { Database } from 'sql.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountGroup, CreateAccountGroupInput } from '../../domain/account-group/AccountGroup'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { seedStandardAccountGroups } from '../../infrastructure/db/seedStandardAccountGroups'
import { AccountCreateForm } from './AccountCreateForm'

let db: Database
let groupRepo: SqlJsAccountGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedStandardAccountGroups(db)
  groupRepo = new SqlJsAccountGroupRepository(db)
  groupRepo.create({ name: '固定費', category: 'expense' })
})

afterEach(cleanup)

function Host({ onCreateGroup, withCreate = true }: { onCreateGroup: (input: CreateAccountGroupInput) => Promise<AccountGroup>; withCreate?: boolean }) {
  const [groups, setGroups] = useState<AccountGroup[]>(() => groupRepo.findAll())
  return (
    <I18nextProvider i18n={i18n}>
      <AccountCreateForm
        accountRepository={new SqlJsAccountRepository(db)}
        groups={groups}
        householdMembers={[]}
        initialCategory="expense"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
        onCreateGroup={
          withCreate
            ? async (input) => {
                const created = await onCreateGroup(input)
                setGroups((prev) => [...prev, created])
                return created
              }
            : undefined
        }
      />
    </I18nextProvider>
  )
}

const dialog = (name: string) => within(screen.getByRole('dialog', { name }))
const openCreate = () => {
  fireEvent.click(screen.getByRole('button', { name: /^所属グループ/ }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '所属グループ' })).getByRole('button', { name: '+ グループを新規追加' }))
}

describe('AccountCreateForm: グループの新規追加', () => {
  it('onCreateGroupを渡さなければ「+ グループを新規追加」を出さない', () => {
    render(<Host onCreateGroup={vi.fn()} withCreate={false} />)

    fireEvent.click(screen.getByRole('button', { name: /^所属グループ/ }))

    expect(within(screen.getByRole('dialog', { name: '所属グループ' })).queryByRole('button', { name: '+ グループを新規追加' })).not.toBeInTheDocument()
  })

  it('親グループを選ばずに追加すると最上位(parentGroupId=null)で作られ、そのまま所属グループに選ばれる', async () => {
    const onCreateGroup = vi.fn(async (input: CreateAccountGroupInput) => groupRepo.create(input))
    render(<Host onCreateGroup={onCreateGroup} />)

    openCreate()
    expect(dialog('科目グループを追加').getByRole('button', { name: /^親グループ: 最上位/ })).toBeInTheDocument()
    fireEvent.change(dialog('科目グループを追加').getByLabelText('グループ名'), { target: { value: '定額サービス' } })
    fireEvent.click(dialog('科目グループを追加').getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith({ name: '定額サービス', category: 'expense', parentGroupId: null }))
    expect(await screen.findByRole('button', { name: '所属グループ: 定額サービス' })).toBeInTheDocument()
  })

  it('親グループには登録中の区分(費用)のグループだけが並び、選んだ親の直下に作られる', async () => {
    const onCreateGroup = vi.fn(async (input: CreateAccountGroupInput) => groupRepo.create(input))
    render(<Host onCreateGroup={onCreateGroup} />)
    const parentId = groupRepo.findAll().find((g) => g.name === '固定費')!.id

    openCreate()
    fireEvent.change(dialog('科目グループを追加').getByLabelText('グループ名'), { target: { value: '定額サービス' } })
    fireEvent.click(dialog('科目グループを追加').getByRole('button', { name: /^親グループ/ }))
    const parentOptions = within(screen.getByRole('dialog', { name: '親グループ' }))
    expect(parentOptions.queryByRole('button', { name: '普通預金' })).not.toBeInTheDocument()
    fireEvent.click(parentOptions.getByRole('button', { name: '固定費' }))
    fireEvent.click(dialog('科目グループを追加').getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith({ name: '定額サービス', category: 'expense', parentGroupId: parentId }))
  })
})
