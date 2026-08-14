// @vitest-environment jsdom
/**
 * 「その他の科目を追加する」フォーム(計画Issue #95)のコンポーネントテスト。
 * 区分選択(equityを除く資産/負債/収益/費用)・名前入力・名義選択(任意)、
 * 資産/負債選択時のみ表示される突合設問(reconciliationQuestion.ts再利用)による
 * is_reconcilableの決定、確定時のRepository呼び出しを、sql.jsのNode実装
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
import { OtherAccountCreationForm } from './OtherAccountCreationForm'

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

function renderForm(onComplete: (account: unknown) => void, onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <OtherAccountCreationForm
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={onComplete}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

describe('OtherAccountCreationForm', () => {
  it.each([
    ['asset', '例: 未収金'],
    ['liability', '例: 立替金'],
    ['revenue', '例: 副業収入'],
    ['expense', '例: 食費'],
  ])(
    '区分「%s」を選ぶと、名前入力欄のプレースホルダーがその区分に応じた例文になり、口座登録ウィザードの「三菱UFJ銀行」は表示されない',
    async (category, expectedPlaceholder) => {
      renderForm(vi.fn())

      fireEvent.change(await screen.findByLabelText('区分'), { target: { value: category } })

      expect(screen.getByLabelText('名前を付ける')).toHaveAttribute('placeholder', expectedPlaceholder)
    },
  )

  it('区分選択肢に純資産(equity)は含まれない。資産・負債は口座登録ウィザード等との使い分けが伝わる注記付きの文言になっている', async () => {
    renderForm(vi.fn())

    const select = await screen.findByLabelText('区分')
    const optionLabels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent)
    expect(optionLabels).toEqual(['資産(未収金など)', '負債(ローン・立替金など)', '収益', '費用'])
  })

  it('画面上部に、銀行口座・クレジットカード等はこのフォームの対象外である旨の説明文が表示される', async () => {
    renderForm(vi.fn())

    expect(
      await screen.findByText(
        '銀行口座・現金・電子マネー・証券口座、クレジットカードはそれぞれ専用の登録画面をご利用ください。ここでは未収金や個人間の立て替えなど特殊な資産・負債、収益・費用の科目を追加できます。',
      ),
    ).toBeInTheDocument()
  })

  it('資産を選ぶと突合設問が表示され、回答するまで登録ボタンが無効になる', async () => {
    renderForm(vi.fn())

    fireEvent.change(await screen.findByLabelText('区分'), { target: { value: 'asset' } })
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '未収金' } })

    expect(screen.getByText('外部明細(CSV)と自動で突合しますか?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('自動で突合する'))
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
  })

  it('資産科目を「突合する」で登録すると is_reconcilable = true で作成されonCompleteが呼ばれる', async () => {
    const onComplete = vi.fn()
    renderForm(onComplete)

    fireEvent.change(await screen.findByLabelText('区分'), { target: { value: 'asset' } })
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '未収金' } })
    fireEvent.click(screen.getByLabelText('自動で突合する'))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const created = onComplete.mock.calls[0][0]
    expect(created).toMatchObject({ category: 'asset', name: '未収金', isReconcilable: true })
  })

  it('収益を選ぶと突合設問は表示されず、名前だけで登録できる(is_reconcilable = null)', async () => {
    const onComplete = vi.fn()
    renderForm(onComplete)

    fireEvent.change(await screen.findByLabelText('区分'), { target: { value: 'revenue' } })
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '副業収入' } })

    expect(screen.queryByText('外部明細(CSV)と自動で突合しますか?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const created = onComplete.mock.calls[0][0]
    expect(created).toMatchObject({ category: 'revenue', name: '副業収入', isReconcilable: null })
  })

  it('名義を選択して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '花子' })
    const onComplete = vi.fn()
    renderForm(onComplete)

    fireEvent.change(await screen.findByLabelText('区分'), { target: { value: 'expense' } })
    fireEvent.change(screen.getByLabelText('名前を付ける'), { target: { value: '娯楽費' } })
    fireEvent.change(screen.getByLabelText('名義'), { target: { value: String(member.id) } })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0]).toMatchObject({ householdMemberId: member.id })
  })

  it('非アクティブな世帯メンバーは名義の選択肢に表示されない', async () => {
    const member = householdMemberRepository.create({ name: '退会済み' })
    householdMemberRepository.deactivate(member.id)

    renderForm(vi.fn())

    const select = await screen.findByLabelText('名義')
    expect(screen.queryByText('退会済み')).not.toBeInTheDocument()
    expect(select).toBeInTheDocument()
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderForm(vi.fn(), onBack)

    fireEvent.click(await screen.findByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
