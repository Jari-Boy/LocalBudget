// @vitest-environment jsdom
/**
 * 口座登録ウィザード(docs/domain/accounts.md 4章)のコンポーネントテスト。
 * 種類選択→名前入力→名義選択(kind = bank/investment/e_moneyは必須、
 * cashはステップ自体を非表示)→初期残高入力(任意)のステップ構成と、
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

function renderWizard(onComplete: (account: unknown) => void, onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountRegistrationWizard
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={onComplete}
        onBack={onBack}
        today="2026-08-03"
      />
    </I18nextProvider>,
  )
}

describe('AccountRegistrationWizard', () => {
  it('種類選択ステップ(最初のステップ)に戻るボタンが表示され、押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderWizard(vi.fn(), onBack)

    fireEvent.click(await screen.findByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('種類選択ステップは「口座」(銀行口座・証券口座)と「現金・電子マネー」のグループに分けて表示される', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    const bankAccountsGroup = (await screen.findByText('口座')).closest('div')!
    expect(bankAccountsGroup).toHaveTextContent('銀行口座')
    expect(bankAccountsGroup).toHaveTextContent('証券・投資口座')
    expect(bankAccountsGroup).not.toHaveTextContent('現金')

    const cashLikeGroup = screen.getByText('現金・電子マネー').closest('div')!
    expect(cashLikeGroup).toHaveTextContent('現金')
    expect(cashLikeGroup).toHaveTextContent('電子マネー')
  })

  it.each([
    ['銀行口座', '例: 三菱UFJ銀行'],
    ['証券・投資口座', '例: SBI証券'],
    ['電子マネー', '例: 楽天Edy'],
  ])(
    '種類「%s」を選ぶと、名前入力欄のプレースホルダーがその種類に応じた例文になる',
    async (kindLabel, expectedPlaceholder) => {
      renderWizard(vi.fn())

      fireEvent.click(await screen.findByRole('button', { name: kindLabel }))

      expect(screen.getByLabelText('名前を付ける')).toHaveAttribute('placeholder', expectedPlaceholder)
    },
  )

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
    expect(screen.queryByText('名義を選ぶ')).not.toBeInTheDocument()
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

  it('現金を選ぶと名前入力ステップを経ずに科目名が自動的に「現金」でis_reconcilable = falseで登録される', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    // 現金は名前入力・名義選択のいずれのステップも経ず、種類選択の1クリックで
    // 初期残高入力ステップへ直接進む(世帯メンバーが未登録のため単一の金額入力、計画Issue #90)
    fireEvent.click(await screen.findByRole('button', { name: '現金' }))
    expect(screen.getByLabelText('初期残高を入力(任意)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount.name).toBe('現金')
    expect(createdAccount.isReconcilable).toBe(false)
  })

  it('現金を選ぶと世帯メンバーが登録済みでも名義選択ステップが表示されず、世帯メンバーごとの初期残高入力に進む', async () => {
    householdMemberRepository.create({ name: '太郎' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '現金' }))

    // cashは世帯メンバーの登録有無に関わらず名義選択ステップ自体を表示しない(4.1節)
    expect(screen.queryByText('名義を選ぶ')).not.toBeInTheDocument()
    // 世帯メンバーが1人以上いる場合、単一の初期残高入力ではなく世帯メンバーごとの
    // 入力欄が表示される(計画Issue #90)
    expect(screen.queryByLabelText('初期残高を入力(任意)')).not.toBeInTheDocument()
    expect(screen.getByLabelText('太郎')).toBeInTheDocument()
  })

  it.each(['銀行口座', '証券・投資口座', '電子マネー'])(
    '%sを選んだ場合、名義選択ステップで世帯メンバーを選ぶまで次のステップに進めない',
    async (kindLabel) => {
      householdMemberRepository.create({ name: '太郎' })
      const onComplete = vi.fn()
      renderWizard(onComplete)

      fireEvent.click(await screen.findByRole('button', { name: kindLabel }))
      fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: 'テスト口座' } })
      fireEvent.click(screen.getByRole('button', { name: '次へ' }))

      expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '世帯共通' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: '太郎' }))
      expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled()
    },
  )

  it('世帯メンバーが登録済みの場合、名義選択ステップが表示され選択した名義で登録される', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '太郎' }))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount.householdMemberId).toBe(member.id)
  })

  it('初期残高を入力すると、初期残高科目と初期仕訳が自動生成される', async () => {
    householdMemberRepository.create({ name: '自分' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '自分' }))
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

  it('現金を選び世帯メンバーが複数登録されている場合、世帯メンバーごとに初期残高を入力でき、それぞれの仕訳明細に反映される(計画Issue #90、起票者は世帯メンバーの先頭にフォールバックする計画Issue #88)', async () => {
    const taro = householdMemberRepository.create({ name: '太郎' })
    const hanako = householdMemberRepository.create({ name: '花子' })
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '現金' }))

    fireEvent.change(screen.getByLabelText('太郎'), { target: { value: '5000' } })
    // 花子の欄は未入力のまま登録する
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const account = accountRepository.findAll()[0]
    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].householdMemberId).toBe(taro.id)
    const debitLines = entries[0].lines.filter((line) => line.side === 'debit')
    expect(debitLines).toEqual([
      expect.objectContaining({ accountId: account.id, amount: 5000, householdMemberId: taro.id }),
    ])
    expect(debitLines.some((line) => line.householdMemberId === hanako.id)).toBe(false)
  })

  it('初期残高に0を入力した場合、初期残高科目・仕訳は作成されず口座のみ登録される', async () => {
    const onComplete = vi.fn()
    renderWizard(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.change(screen.getByLabelText('初期残高を入力(任意)'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(journalEntryRepository.findAll()).toHaveLength(0)
    expect(accountRepository.findAll()).toHaveLength(1)
  })

  it('Repository呼び出しが失敗した場合、エラーメッセージを表示し再度登録操作ができる状態に戻す', async () => {
    const failingAccountRepository = {
      create: () => Promise.reject(new Error('DB error')),
    }
    const onComplete = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <AccountRegistrationWizard
          accountRepository={failingAccountRepository}
          journalEntryRepository={journalEntryRepository}
          householdMemberRepository={householdMemberRepository}
          onComplete={onComplete}
          onBack={vi.fn()}
          today="2026-08-03"
        />
      </I18nextProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '銀行口座' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), {
      target: { value: '三菱UFJ銀行' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
  })
})
