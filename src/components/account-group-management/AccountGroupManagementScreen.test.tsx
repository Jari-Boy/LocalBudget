// @vitest-environment jsdom
/**
 * 勘定科目グループ管理画面(計画Issue #112)のコンポーネントテスト。
 * 登録済みグループの一覧表示(深さに応じたインデント付きフラットリスト、
 * 展開/折りたたみ式ツリーは使わない)、新規作成(名称・親グループ)、編集(名称・
 * 親グループの変更)、削除(子グループ・所属科目がともに0件の場合のみ)・非アクティブ化を、
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
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { AccountGroupManagementScreen } from './AccountGroupManagementScreen'

let db: Database
let accountGroupRepository: SqlJsAccountGroupRepository
let accountRepository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountGroupRepository = new SqlJsAccountGroupRepository(db)
  accountRepository = new SqlJsAccountRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountGroupManagementScreen
        accountGroupRepository={accountGroupRepository}
        accountRepository={accountRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('AccountGroupManagementScreen', () => {
  it('登録済みグループが名称とともに一覧表示される', async () => {
    accountGroupRepository.create({ name: '水道光熱費' })

    renderScreen()

    expect(await screen.findByText('水道光熱費')).toBeInTheDocument()
  })

  it('グループが0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen()

    expect(await screen.findByText('登録済みのグループがありません')).toBeInTheDocument()
  })

  it('子グループは親グループより深いインデント(data-depth)で表示される', async () => {
    const parent = accountGroupRepository.create({ name: '固定費' })
    accountGroupRepository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    renderScreen()

    const parentItem = (await screen.findByText('固定費')).closest('li')!
    const childItem = (await screen.findByText('クレジットカード')).closest('li')!
    expect(parentItem).toHaveAttribute('data-depth', '0')
    expect(childItem).toHaveAttribute('data-depth', '1')
  })

  it('親グループを指定せずに新規グループを作成できる', async () => {
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '水道光熱費' } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    expect(await screen.findByText('水道光熱費')).toBeInTheDocument()
    expect(accountGroupRepository.findAll()).toHaveLength(1)
  })

  it('親グループを選択して子グループを作成できる', async () => {
    const parent = accountGroupRepository.create({ name: '固定費' })
    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'クレジットカード' } })
    fireEvent.change(screen.getByLabelText('親グループ'), { target: { value: String(parent.id) } })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    await screen.findByText('クレジットカード')
    expect(accountGroupRepository.findById(accountGroupRepository.findAll()[1].id)?.parentGroupId).toBe(
      parent.id,
    )
  })

  it('親グループ選択欄は、異なる親配下の同名グループを「親 > 子」形式のパス表示で区別できる', async () => {
    const fixedCost = accountGroupRepository.create({ name: '固定費' })
    const variableCost = accountGroupRepository.create({ name: '変動費' })
    accountGroupRepository.create({ name: 'カード', parentGroupId: fixedCost.id })
    accountGroupRepository.create({ name: 'カード', parentGroupId: variableCost.id })

    renderScreen()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'グループを追加' }))

    const parentSelect = screen.getByLabelText('親グループ')
    expect(within(parentSelect).getByText('固定費 > カード')).toBeInTheDocument()
    expect(within(parentSelect).getByText('変動費 > カード')).toBeInTheDocument()
  })

  it('同一親内で既存の別グループと同じ名前に変更しようとすると、UNIQUE制約違反(同期例外)がエラーメッセージとして表示され、操作ボタンが再び有効になる', async () => {
    accountGroupRepository.create({ name: '水道光熱費' })
    accountGroupRepository.create({ name: '通信費' })
    renderScreen()
    const item = (await screen.findByText('通信費')).closest('li')!

    fireEvent.click(within(item).getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '水道光熱費' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました。もう一度お試しください。')
    await waitFor(() => expect(screen.getByRole('button', { name: '保存する' })).toBeEnabled())
  })

  it('既存グループの名称を編集できる', async () => {
    accountGroupRepository.create({ name: '水道光熱費' })
    renderScreen()
    await screen.findByText('水道光熱費')

    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '光熱費' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText('光熱費')).toBeInTheDocument()
  })

  it('子グループを持つグループには削除ボタンが表示されない', async () => {
    const parent = accountGroupRepository.create({ name: '固定費' })
    accountGroupRepository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    renderScreen()

    const parentItem = (await screen.findByText('固定費')).closest('li')!
    expect(parentItem.querySelector('button[data-action="delete"]')).not.toBeInTheDocument()
  })

  it('所属する勘定科目があるグループには削除ボタンが表示されない', async () => {
    const group = accountGroupRepository.create({ name: '水道光熱費' })
    accountRepository.create({
      category: 'expense',
      name: '電気代',
      isReconcilable: null,
      accountGroupId: group.id,
    })

    renderScreen()

    const item = (await screen.findByText('水道光熱費')).closest('li')!
    expect(item.querySelector('button[data-action="delete"]')).not.toBeInTheDocument()
  })

  it('参照が無いグループは削除でき一覧から消える', async () => {
    accountGroupRepository.create({ name: '使わないグループ' })
    renderScreen()
    const item = (await screen.findByText('使わないグループ')).closest('li')!

    fireEvent.click(item.querySelector('button[data-action="delete"]')!)

    await waitFor(() => expect(screen.queryByText('使わないグループ')).not.toBeInTheDocument())
    expect(accountGroupRepository.findAll()).toHaveLength(0)
  })

  it('is_active = trueのグループを非アクティブ化できる', async () => {
    accountGroupRepository.create({ name: '使わなくなった分類' })
    renderScreen()
    const item = (await screen.findByText('使わなくなった分類')).closest('li')!

    fireEvent.click(item.querySelector('button[data-action="deactivate"]')!)

    await waitFor(() => expect(item).toHaveTextContent('非アクティブ'))
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  describe('科目の一括割り当て', () => {
    it('「科目を割り当てる」を押すと、is_system_managedを除く全科目がチェックボックスで表示され、現在このグループに属する科目のみ初期チェックされる', async () => {
      const group = accountGroupRepository.create({ name: '水道光熱費' })
      accountRepository.create({
        category: 'expense',
        name: '電気代',
        isReconcilable: null,
        accountGroupId: group.id,
      })
      accountRepository.create({ category: 'expense', name: 'ガス代', isReconcilable: null })
      accountRepository.create({
        category: 'equity',
        name: '初期残高(現金)',
        isReconcilable: null,
        isSystemManaged: true,
      })

      renderScreen()
      const item = (await screen.findByText('水道光熱費')).closest('li')!

      fireEvent.click(within(item).getByRole('button', { name: '科目を割り当てる' }))

      expect(await screen.findByRole('checkbox', { name: /電気代/ })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: /ガス代/ })).not.toBeChecked()
      expect(screen.queryByText('初期残高(現金)')).not.toBeInTheDocument()
    })

    it('チェックを入れて適用すると、その科目がこのグループに割り当てられる', async () => {
      const group = accountGroupRepository.create({ name: '水道光熱費' })
      accountRepository.create({ category: 'expense', name: 'ガス代', isReconcilable: null })

      renderScreen()
      const item = (await screen.findByText('水道光熱費')).closest('li')!
      fireEvent.click(within(item).getByRole('button', { name: '科目を割り当てる' }))

      fireEvent.click(await screen.findByRole('checkbox', { name: /ガス代/ }))
      fireEvent.click(screen.getByRole('button', { name: '適用する' }))

      await waitFor(() =>
        expect(accountRepository.findAll().find((a) => a.name === 'ガス代')?.accountGroupId).toBe(
          group.id,
        ),
      )
    })

    it('チェックを外して適用すると、その科目が未分類に戻る', async () => {
      const group = accountGroupRepository.create({ name: '水道光熱費' })
      accountRepository.create({
        category: 'expense',
        name: '電気代',
        isReconcilable: null,
        accountGroupId: group.id,
      })

      renderScreen()
      const item = (await screen.findByText('水道光熱費')).closest('li')!
      fireEvent.click(within(item).getByRole('button', { name: '科目を割り当てる' }))

      fireEvent.click(await screen.findByRole('checkbox', { name: /電気代/ }))
      fireEvent.click(screen.getByRole('button', { name: '適用する' }))

      await waitFor(() =>
        expect(
          accountRepository.findAll().find((a) => a.name === '電気代')?.accountGroupId,
        ).toBeNull(),
      )
    })

    it('他のグループに属する科目をチェックして適用すると、そのグループから外れてこのグループに移動する', async () => {
      const oldGroup = accountGroupRepository.create({ name: '通信費' })
      const newGroup = accountGroupRepository.create({ name: '水道光熱費' })
      accountRepository.create({
        category: 'expense',
        name: 'スマホ代',
        isReconcilable: null,
        accountGroupId: oldGroup.id,
      })

      renderScreen()
      const item = (await screen.findByText('水道光熱費')).closest('li')!
      fireEvent.click(within(item).getByRole('button', { name: '科目を割り当てる' }))

      const checkbox = await screen.findByRole('checkbox', { name: /スマホ代/ })
      expect(checkbox.closest('label')).toHaveTextContent('通信費')
      fireEvent.click(checkbox)
      fireEvent.click(screen.getByRole('button', { name: '適用する' }))

      await waitFor(() =>
        expect(accountRepository.findAll().find((a) => a.name === 'スマホ代')?.accountGroupId).toBe(
          newGroup.id,
        ),
      )
    })
  })
})
