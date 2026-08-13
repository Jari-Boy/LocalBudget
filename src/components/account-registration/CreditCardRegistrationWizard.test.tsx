// @vitest-environment jsdom
/**
 * クレジットカード登録ウィザード(docs/domain/accounts.md 5章)のコンポーネントテスト。
 * 名前入力→名義選択(世帯メンバーが1人以上いる場合は必須)の2ステップと、
 * 世帯メンバー未登録時の名義選択ステップ非表示、確定時にis_reconcilable = false固定の
 * 負債科目が作成されることを、sql.jsのNode実装(createTestDatabase)を使った統合的な
 * レンダリングテストとして検証する。外部依存: sql.js(ネットワークアクセスなし)。
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
import { CreditCardRegistrationWizard } from './CreditCardRegistrationWizard'

let db: Database
let accountRepository: SqlJsAccountRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
})

afterEach(cleanup)

function renderWizard(onComplete: (account: unknown) => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CreditCardRegistrationWizard
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={onComplete}
      />
    </I18nextProvider>,
  )
}

describe('CreditCardRegistrationWizard', () => {
  it('世帯メンバーが未登録の場合、名義選択ステップを経ずにカードを登録できる', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.change(await screen.findByLabelText('名前を付ける'), {
      target: { value: '楽天カード' },
    })

    expect(screen.queryByText('名義を選ぶ')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount).toMatchObject({
      category: 'liability',
      name: '楽天カード',
      isReconcilable: false,
    })
  })

  it('世帯メンバーが登録済みの場合、名義選択ステップが表示され選ぶまで登録できない', async () => {
    const member = householdMemberRepository.create({ name: '花子' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.change(await screen.findByLabelText('名前を付ける'), {
      target: { value: '楽天カード' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '世帯共通' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '花子' }))
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount.householdMemberId).toBe(member.id)
  })

  it('Repository呼び出しが失敗した場合、エラーメッセージを表示し再度登録操作ができる状態に戻す', async () => {
    const failingAccountRepository = {
      create: () => Promise.reject(new Error('DB error')),
    }
    const onComplete = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <CreditCardRegistrationWizard
          accountRepository={failingAccountRepository}
          householdMemberRepository={householdMemberRepository}
          onComplete={onComplete}
        />
      </I18nextProvider>,
    )

    fireEvent.change(await screen.findByLabelText('名前を付ける'), {
      target: { value: '楽天カード' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
  })
})
