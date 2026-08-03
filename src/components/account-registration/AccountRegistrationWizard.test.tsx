// @vitest-environment jsdom
/**
 * 口座登録ウィザード(docs/domain/accounts.md 4章)のコンポーネントテスト。
 * 種類選択→名前入力→名義選択(任意)→初期残高入力(任意)の4ステップと、
 * 世帯メンバー未登録時の名義選択ステップ非表示、確定時のRepository呼び出しを、
 * sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
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
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { AccountRegistrationWizard } from './AccountRegistrationWizard'

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

function renderWizard(onComplete: (account: unknown) => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountRegistrationWizard
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={onComplete}
        today="2026-08-03"
      />
    </I18nextProvider>,
  )
}

describe('AccountRegistrationWizard', () => {
  it('世帯メンバーが未登録の場合、名義選択ステップを経ずに口座を登録できる(初期残高なし)', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    // ステップ1: 種類選択
    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))

    // ステップ2: 名前入力
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    // 名義選択ステップは表示されず、初期残高入力ステップに直接進む
    expect(screen.queryByText('名義を選ぶ(任意)')).not.toBeInTheDocument()
    expect(screen.getByText('初期残高を入力(任意)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount).toMatchObject({
      category: 'asset',
      name: '三菱UFJ銀行',
      isReconcilable: true,
    })
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('現金を選ぶとis_reconcilableがfalseで登録される', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '現金' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '財布' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount.isReconcilable).toBe(false)
  })

  it('世帯メンバーが登録済みの場合、名義選択ステップが表示され選択した名義で登録される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    expect(screen.getByText('名義を選ぶ(任意)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '太郎' }))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount.householdMemberId).toBe(member.id)
  })

  it('初期残高を入力すると、初期残高科目と初期仕訳が自動生成される', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.change(screen.getByLabelText('初期残高を入力(任意)'), {
      target: { value: '100000' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      entryDate: '2026-08-03',
      sourceType: 'initial_balance',
    })
  })
})
