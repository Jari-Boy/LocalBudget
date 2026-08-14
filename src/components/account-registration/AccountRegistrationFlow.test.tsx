// @vitest-environment jsdom
/**
 * 勘定科目の統合登録フロー(docs/domain/accounts.md 4章、計画Issue #102)のコンポーネントテスト。
 * 入口(資産・負債 or 収益・費用)→
 *   資産・負債: 資産/負債選択→外部明細の有無→(ありの場合のみ)残高情報の有無→
 *     名義選択(外部明細ありは必須・なしは任意)→科目名→初期残高(任意)
 *   収益・費用: カテゴリ選択→科目名の2ステップのみで完結
 * という単一フローに、口座の「種類」による特別扱いなしにis_reconcilableを2軸で決定する
 * ロジック・名義選択の必須/任意切り替えが正しく組み込まれていることを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
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
import { AccountRegistrationFlow } from './AccountRegistrationFlow'

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

function renderFlow(onComplete: (account: unknown) => void, onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountRegistrationFlow
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

describe('AccountRegistrationFlow', () => {
  it('入口ステップ(最初のステップ)に戻るボタンが表示され、押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderFlow(vi.fn(), onBack)

    fireEvent.click(await screen.findByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('入口で「資産・負債」を選ぶと、続けて「資産」「負債」の2択が表示される', async () => {
    renderFlow(vi.fn())

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))

    expect(screen.getByRole('button', { name: '資産' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '負債' })).toBeInTheDocument()
  })

  it('入口で「収益・費用」を選ぶと、続けて「収益」「費用」の2択が表示される', async () => {
    renderFlow(vi.fn())

    fireEvent.click(await screen.findByRole('button', { name: '収益・費用' }))

    expect(screen.getByRole('button', { name: '収益' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '費用' })).toBeInTheDocument()
  })

  it('資産を選ぶと「外部明細(CSV)はありますか?」の設問が表示される', async () => {
    renderFlow(vi.fn())

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))

    expect(screen.getByText('外部明細(CSV)はありますか?')).toBeInTheDocument()
  })

  it('外部明細「ある」を選ぶと、続けて「残高情報は明細にありますか?」の設問が追加表示される', async () => {
    renderFlow(vi.fn())

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))

    expect(screen.getByText('残高情報は明細にありますか?')).toBeInTheDocument()
  })

  it('外部明細「ある」・残高情報「ある」の場合、is_reconcilable = trueで登録される(例: 銀行口座)', async () => {
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))

    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '三菱UFJ銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount).toMatchObject({
      category: 'asset',
      name: '三菱UFJ銀行',
      isReconcilable: true,
    })
  })

  it('外部明細「ある」・残高情報「ない」の場合、is_reconcilable = falseで登録される(例: クレジットカード)', async () => {
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '負債' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))
    fireEvent.click(screen.getByRole('button', { name: 'ない' }))

    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '楽天カード' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount).toMatchObject({
      category: 'liability',
      name: '楽天カード',
      isReconcilable: false,
    })
  })

  it('外部明細「ない」の場合、残高情報の設問は表示されずis_reconcilable = falseで登録される(例: 現金)', async () => {
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ない' }))

    expect(screen.queryByText('残高情報は明細にありますか?')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '現金' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(accountRepository.findAll()[0].isReconcilable).toBe(false)
  })

  it('外部明細「ある」の場合、世帯メンバーが登録済みなら名義選択が必須になる(「全員」ボタンは表示されず、選ぶまで次へ進めない)', async () => {
    householdMemberRepository.create({ name: '太郎' })
    renderFlow(vi.fn())

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))

    expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全員' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '太郎' }))
    expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled()
  })

  it('外部明細「ない」の場合、世帯メンバーが登録済みでも名義選択は任意になる(「全員」ボタンで選ばずに次へ進める)', async () => {
    householdMemberRepository.create({ name: '太郎' })
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ない' }))

    expect(screen.getByText('名義を選ぶ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全員' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '現金' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(accountRepository.findAll()[0].householdMemberId).toBeNull()
  })

  it('初期残高を入力すると、初期残高科目と初期仕訳が自動生成される', async () => {
    householdMemberRepository.create({ name: '自分' })
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))
    fireEvent.click(screen.getByRole('button', { name: 'ある' }))
    fireEvent.click(screen.getByRole('button', { name: '自分' }))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '三菱UFJ銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    fireEvent.change(screen.getByLabelText('初期残高を入力(任意)'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entryDate: '2026-08-03', sourceType: 'initial_balance' })
  })

  it('初期残高を入力しない場合、初期残高科目・仕訳は作成されず科目のみ登録される', async () => {
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '資産・負債' }))
    fireEvent.click(screen.getByRole('button', { name: '資産' }))
    fireEvent.click(screen.getByRole('button', { name: 'ない' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '現金' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('収益・費用フローは「カテゴリ選択→科目名入力」の2ステップのみで完結し、is_reconcilable = nullで登録される(名義選択ステップは無い)', async () => {
    householdMemberRepository.create({ name: '太郎' })
    const onComplete = vi.fn()
    renderFlow(onComplete)

    fireEvent.click(await screen.findByRole('button', { name: '収益・費用' }))
    fireEvent.click(screen.getByRole('button', { name: '収益' }))

    expect(screen.queryByText('名義を選ぶ')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '副業収入' } })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdAccount = accountRepository.findAll()[0]
    expect(createdAccount).toMatchObject({
      category: 'revenue',
      name: '副業収入',
      isReconcilable: null,
      householdMemberId: null,
    })
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('Repository呼び出しが失敗した場合、エラーメッセージを表示し再度登録操作ができる状態に戻す', async () => {
    const failingAccountRepository = {
      create: () => Promise.reject(new Error('DB error')),
    }
    const onComplete = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <AccountRegistrationFlow
          accountRepository={failingAccountRepository}
          journalEntryRepository={journalEntryRepository}
          householdMemberRepository={householdMemberRepository}
          onComplete={onComplete}
          onBack={vi.fn()}
          today="2026-08-03"
        />
      </I18nextProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '収益・費用' }))
    fireEvent.click(screen.getByRole('button', { name: '費用' }))
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '娯楽費' } })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
  })
})
