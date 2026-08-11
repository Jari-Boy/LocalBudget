// @vitest-environment jsdom
/**
 * 登録済み科目一覧確認画面(計画Issue #70)のコンポーネントテスト。
 * isSystemManaged科目を除いた登録済み全科目が、区分を問わずフラットな一覧として
 * 名称・残高・(あれば)世帯メンバー名とともに表示されること、0件時の空状態表示、
 * 戻る操作を、sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテスト
 * として検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { AccountListScreen } from './AccountListScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountListScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('AccountListScreen', () => {
  it('登録済み科目が名称と残高とともに一覧表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
      householdMemberId: null,
    })
    const equity = accountRepository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-08-11',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 50000 },
        { accountId: equity.id, side: 'credit', amount: 50000 },
      ],
    })

    renderScreen(vi.fn())

    expect(await screen.findByText('普通預金')).toBeInTheDocument()
    expect(screen.getByText('￥50,000')).toBeInTheDocument()
  })

  it('isSystemManagedな科目(初期残高科目等)は一覧に表示されない', async () => {
    accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    accountRepository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    renderScreen(vi.fn())

    await screen.findByText('普通預金')
    expect(screen.queryByText('初期残高(普通預金)')).not.toBeInTheDocument()
  })

  it('householdMemberIdが設定された科目には世帯メンバー名が併記される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    accountRepository.create({
      category: 'asset',
      name: '太郎の口座',
      isReconcilable: true,
      householdMemberId: member.id,
    })
    accountRepository.create({
      category: 'asset',
      name: '共通口座',
      isReconcilable: true,
    })

    renderScreen(vi.fn())

    const taroItem = (await screen.findByText('太郎の口座')).closest('li')!
    expect(taroItem).toHaveTextContent('太郎')

    const sharedItem = screen.getByText('共通口座').closest('li')!
    expect(sharedItem).not.toHaveTextContent('太郎')
  })

  it('登録済み科目が0件の場合はエラーにならず空状態が表示される', async () => {
    renderScreen(vi.fn())

    expect(await screen.findByText('登録済みの科目がありません')).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('一覧の並び順はAccountRepository.findAll()の返り順(登録順)と一致する', async () => {
    accountRepository.create({ category: 'asset', name: 'B口座', isReconcilable: true })
    accountRepository.create({ category: 'asset', name: 'A口座', isReconcilable: true })

    renderScreen(vi.fn())

    await screen.findByText('B口座')
    const names = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(names[0]).toContain('B口座')
    expect(names[1]).toContain('A口座')
  })
})
