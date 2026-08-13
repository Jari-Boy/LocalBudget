// @vitest-environment jsdom
/**
 * マニュアル仕訳入力フォーム(計画Issue #32)のコンポーネントテスト。
 * 2行仕訳・複合仕訳(3行以上)の入力、借方/貸方合計・差額のリアルタイム表示、
 * デバウンスによる下書き自動保存、既存下書きからの再開、確定操作(貸借バランス検証
 * エラーのフィードバックを含む)、取引先入力欄がPL科目行にのみ表示されることを、
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
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryDraftRepository } from '../../infrastructure/db/SqlJsJournalEntryDraftRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { JournalEntryForm, type JournalEntryDraftClient } from './JournalEntryForm'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let journalEntryDraftRepositoryImpl: SqlJsJournalEntryDraftRepository
let journalEntryDraftRepository: JournalEntryDraftClient

// fake timers(shouldAdvanceTime)を使う統合テストは、テストスイート全体を並列実行する際の
// CPU負荷でデフォルトタイムアウト(5000ms)を超えることがあるため長めに設定する。
vi.setConfig({ testTimeout: 10000 })

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  journalEntryDraftRepositoryImpl = new SqlJsJournalEntryDraftRepository(db)
  journalEntryDraftRepository = {
    create: (input) => journalEntryDraftRepositoryImpl.create(input),
    update: (id, input) => journalEntryDraftRepositoryImpl.update(id, input),
    confirm: (id) => journalEntryDraftRepositoryImpl.confirm(id, journalEntryRepository),
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderForm(props?: { onComplete?: (entry: unknown) => void }) {
  const onComplete = props?.onComplete ?? vi.fn()
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryForm
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        journalEntryRepository={journalEntryRepository}
        journalEntryDraftRepository={journalEntryDraftRepository}
        onComplete={onComplete}
        onBack={vi.fn()}
        today="2026-08-11"
        draftSaveDebounceMs={2000}
      />
    </I18nextProvider>,
  )
  return { ...utils, onComplete }
}

function createAccount(overrides: {
  name: string
  category: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
}) {
  return accountRepository.create({
    category: overrides.category,
    name: overrides.name,
    isReconcilable: overrides.category === 'asset' ? false : null,
  })
}

function selectLineAccount(lineGroup: HTMLElement, accountId: number) {
  fireEvent.change(within(lineGroup).getByLabelText('科目'), { target: { value: String(accountId) } })
}

describe('JournalEntryForm', () => {
  it('初期表示で日付・摘要入力欄と2行分の明細入力欄が表示される', async () => {
    renderForm()

    expect(await screen.findByLabelText('取引日')).toBeInTheDocument()
    expect(screen.getByLabelText('摘要(任意)')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /行目/ })).toHaveLength(2)
  })

  it('行を追加すると入力欄が1行増え、複合仕訳(3行以上)を入力できる', async () => {
    renderForm()
    await screen.findByLabelText('取引日')

    fireEvent.click(screen.getByRole('button', { name: '行を追加する' }))

    expect(screen.getAllByRole('group', { name: /行目/ })).toHaveLength(3)
  })

  it('2行しかない状態では行削除ボタンが無効化され、2行未満にはできない', async () => {
    renderForm()
    await screen.findByLabelText('取引日')

    const removeButtons = screen.getAllByRole('button', { name: 'この行を削除する' })
    expect(removeButtons).toHaveLength(2)
    removeButtons.forEach((button) => expect(button).toBeDisabled())
  })

  it('行を追加してから削除すると、元の行数に戻る', async () => {
    renderForm()
    await screen.findByLabelText('取引日')

    fireEvent.click(screen.getByRole('button', { name: '行を追加する' }))
    expect(screen.getAllByRole('group', { name: /行目/ })).toHaveLength(3)

    const removeButtons = screen.getAllByRole('button', { name: 'この行を削除する' })
    fireEvent.click(removeButtons[2])

    expect(screen.getAllByRole('group', { name: /行目/ })).toHaveLength(2)
  })

  it('借方/貸方の金額入力に応じて借方合計・貸方合計・差額がリアルタイム表示される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '3000' } })

    selectLineAccount(lineGroups[1], cash.id)
    fireEvent.change(within(lineGroups[1]).getByLabelText('借方/貸方'), {
      target: { value: 'credit' },
    })
    fireEvent.change(within(lineGroups[1]).getByLabelText('金額'), { target: { value: '2000' } })

    const totalsSection = screen.getByText('借方合計').closest('.journal-entry-totals') as HTMLElement
    expect(within(totalsSection).getByText('￥3,000')).toBeInTheDocument()
    expect(within(totalsSection).getByText('￥2,000')).toBeInTheDocument()
    expect(within(totalsSection).getByText('￥1,000')).toBeInTheDocument()
  })

  it('取引先入力欄は選択した科目がPL科目(収益/費用)の行にのみ表示される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    expect(within(lineGroups[0]).queryByLabelText('取引先(任意)')).not.toBeInTheDocument()

    selectLineAccount(lineGroups[0], expense.id)
    expect(within(lineGroups[0]).getByLabelText('取引先(任意)')).toBeInTheDocument()

    selectLineAccount(lineGroups[1], cash.id)
    expect(within(lineGroups[1]).queryByLabelText('取引先(任意)')).not.toBeInTheDocument()
  })

  it('isReconcilable = trueの科目(普通預金等)はマニュアル仕訳では直接記帳できないため科目選択の選択肢に表示されない', async () => {
    accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const expense = createAccount({ name: '食費', category: 'expense' })
    void expense

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    const select = within(lineGroups[0]).getByLabelText('科目') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent)
    expect(optionTexts).not.toContain('普通預金')
    expect(optionTexts).toContain('食費')
  })

  it('isSystemManaged = trueの科目(初期残高科目等)はシステム内部管理用のため科目選択の選択肢に表示されない', async () => {
    accountRepository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })
    const expense = createAccount({ name: '食費', category: 'expense' })
    void expense

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    const select = within(lineGroups[0]).getByLabelText('科目') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent)
    expect(optionTexts).not.toContain('初期残高(普通預金)')
    expect(optionTexts).toContain('食費')
  })

  it('2行仕訳を入力して確定すると仕訳が作成され、onCompleteが呼ばれる', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })
    householdMemberRepository.create({ name: '自分' })

    const { onComplete } = renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '3000' } })

    selectLineAccount(lineGroups[1], cash.id)
    fireEvent.change(within(lineGroups[1]).getByLabelText('借方/貸方'), {
      target: { value: 'credit' },
    })
    fireEvent.change(within(lineGroups[1]).getByLabelText('金額'), { target: { value: '3000' } })

    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].lines).toHaveLength(2)
    expect(entries[0].householdMemberId).toBe(householdMemberRepository.findAll()[0].id)
  })

  it('貸借が不一致のまま確定すると、エラーメッセージが表示され仕訳は作成されない', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })

    const { onComplete } = renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '3000' } })

    selectLineAccount(lineGroups[1], cash.id)
    fireEvent.change(within(lineGroups[1]).getByLabelText('借方/貸方'), {
      target: { value: 'credit' },
    })
    fireEvent.change(within(lineGroups[1]).getByLabelText('金額'), { target: { value: '2000' } })

    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('貸借が一致していません')
    expect(onComplete).not.toHaveBeenCalled()
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('マイナスの金額を入力して確定すると、専用のエラーメッセージが表示され仕訳は作成されない(残りの行だけで貸借が偶然一致する場合も含む)', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const daily = createAccount({ name: '日用品費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })

    const { onComplete } = renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    // 1行目はマイナス金額。2・3行目だけなら貸借が一致してしまうケースを検証する
    // (マイナス行が黙って無視され確定されてしまわないことを確認する)。
    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '-1000' } })

    fireEvent.click(screen.getByRole('button', { name: '行を追加する' }))
    const updatedLineGroups = screen.getAllByRole('group', { name: /行目/ })

    selectLineAccount(updatedLineGroups[1], daily.id)
    fireEvent.change(within(updatedLineGroups[1]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(updatedLineGroups[1]).getByLabelText('金額'), { target: { value: '5000' } })

    selectLineAccount(updatedLineGroups[2], cash.id)
    fireEvent.change(within(updatedLineGroups[2]).getByLabelText('借方/貸方'), {
      target: { value: 'credit' },
    })
    fireEvent.change(within(updatedLineGroups[2]).getByLabelText('金額'), { target: { value: '5000' } })

    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('金額には1以上の整数を入力してください')
    expect(onComplete).not.toHaveBeenCalled()
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('入力から一定時間(デバウンス)経過すると下書きとして自動保存される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })
    selectLineAccount(lineGroups[0], expense.id)

    expect(journalEntryDraftRepositoryImpl.findAll()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => {
      const drafts = journalEntryDraftRepositoryImpl.findAll()
      expect(drafts).toHaveLength(1)
      expect(drafts[0].lines[0]?.accountId).toBe(expense.id)
    })
  })

  it('デバウンス完了前に戻るボタンを押しても、直前の入力内容が下書きとして保存される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const onBack = vi.fn()

    render(
      <I18nextProvider i18n={i18n}>
        <JournalEntryForm
          accountRepository={accountRepository}
          projectRepository={projectRepository}
          householdMemberRepository={householdMemberRepository}
          counterpartyRepository={counterpartyRepository}
          journalEntryRepository={journalEntryRepository}
          journalEntryDraftRepository={journalEntryDraftRepository}
          onComplete={vi.fn()}
          onBack={onBack}
          today="2026-08-11"
          draftSaveDebounceMs={2000}
        />
      </I18nextProvider>,
    )

    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })
    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '5000' } })

    // デバウンス(2000ms)が発火する前に戻るボタンを押す
    await vi.advanceTimersByTimeAsync(500)
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    await waitFor(() => {
      const drafts = journalEntryDraftRepositoryImpl.findAll()
      expect(drafts).toHaveLength(1)
      expect(drafts[0].lines[0]?.accountId).toBe(expense.id)
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('何も入力しない場合、下書きは作成されない', async () => {
    renderForm()
    await screen.findByLabelText('取引日')

    await vi.advanceTimersByTimeAsync(5000)

    expect(journalEntryDraftRepositoryImpl.findAll()).toHaveLength(0)
  })

  it('確定成功後、自動保存されていた下書きは削除される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })
    householdMemberRepository.create({ name: '自分' })

    const { onComplete } = renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    selectLineAccount(lineGroups[0], expense.id)
    fireEvent.change(within(lineGroups[0]).getByLabelText('借方/貸方'), {
      target: { value: 'debit' },
    })
    fireEvent.change(within(lineGroups[0]).getByLabelText('金額'), { target: { value: '3000' } })
    selectLineAccount(lineGroups[1], cash.id)
    fireEvent.change(within(lineGroups[1]).getByLabelText('借方/貸方'), {
      target: { value: 'credit' },
    })
    fireEvent.change(within(lineGroups[1]).getByLabelText('金額'), { target: { value: '3000' } })

    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(journalEntryDraftRepositoryImpl.findAll()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(journalEntryDraftRepositoryImpl.findAll()).toHaveLength(0)
  })

  it('既存下書きを渡すと、日付・摘要・明細が復元された状態で表示される', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })
    const draft = journalEntryDraftRepositoryImpl.create({
      entryDate: '2026-08-01',
      memo: '先週のスーパー',
      lines: [
        { accountId: expense.id, side: 'debit', amount: 4000 },
        { accountId: cash.id, side: 'credit', amount: 4000 },
      ],
    })

    render(
      <I18nextProvider i18n={i18n}>
        <JournalEntryForm
          accountRepository={accountRepository}
          projectRepository={projectRepository}
          householdMemberRepository={householdMemberRepository}
          counterpartyRepository={counterpartyRepository}
          journalEntryRepository={journalEntryRepository}
          journalEntryDraftRepository={journalEntryDraftRepository}
          initialDraft={draft}
          onComplete={vi.fn()}
          onBack={vi.fn()}
          today="2026-08-11"
          draftSaveDebounceMs={2000}
        />
      </I18nextProvider>,
    )

    expect(await screen.findByLabelText('取引日')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('摘要(任意)')).toHaveValue('先週のスーパー')
    const lineGroups = screen.getAllByRole('group', { name: /行目/ })
    expect(within(lineGroups[0]).getByLabelText('金額')).toHaveValue(4000)
  })

  it('非アクティブ化済みのプロジェクトはプロジェクト選択欄の新規選択肢に含まれない(docs/domain/projects.md 1.3節)', async () => {
    const activeProject = projectRepository.create({ name: '26年7月アメリカ旅行' })
    const inactiveProject = projectRepository.create({ name: '25年冬の旅行' })
    projectRepository.deactivate(inactiveProject.id)

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })
    const select = within(lineGroups[0]).getByLabelText('プロジェクト(任意)')

    expect(within(select).getByText(activeProject.name)).toBeInTheDocument()
    expect(within(select).queryByText(inactiveProject.name)).not.toBeInTheDocument()
  })

  it('既存下書きが非アクティブ化済みのプロジェクトを参照している場合、選択済みの値は表示から消えない', async () => {
    const expense = createAccount({ name: '食費', category: 'expense' })
    const cash = createAccount({ name: '現金', category: 'asset' })
    const project = projectRepository.create({ name: '終了した旅行' })
    const draft = journalEntryDraftRepositoryImpl.create({
      entryDate: '2026-08-01',
      lines: [
        { accountId: expense.id, side: 'debit', amount: 4000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 4000 },
      ],
    })
    projectRepository.deactivate(project.id)

    render(
      <I18nextProvider i18n={i18n}>
        <JournalEntryForm
          accountRepository={accountRepository}
          projectRepository={projectRepository}
          householdMemberRepository={householdMemberRepository}
          counterpartyRepository={counterpartyRepository}
          journalEntryRepository={journalEntryRepository}
          journalEntryDraftRepository={journalEntryDraftRepository}
          initialDraft={draft}
          onComplete={vi.fn()}
          onBack={vi.fn()}
          today="2026-08-11"
          draftSaveDebounceMs={2000}
        />
      </I18nextProvider>,
    )

    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })
    const select = within(lineGroups[0]).getByLabelText('プロジェクト(任意)')
    expect(select).toHaveValue(String(project.id))
    expect(within(select).getByText('終了した旅行')).toBeInTheDocument()
  })

  it('ヘッダーの起票者は世帯メンバーの先頭を初期値とし、科目に既定値の無い明細行にはその値がデフォルト表示されつつ、明細ごとに変更できる(計画Issue #88)', async () => {
    const husband = householdMemberRepository.create({ name: '夫' })
    const wife = householdMemberRepository.create({ name: '妻' })
    const expense = createAccount({ name: '食費', category: 'expense' })

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    expect(await screen.findByLabelText('起票者')).toHaveValue(String(husband.id))

    selectLineAccount(lineGroups[0], expense.id)
    const memberSelect = within(lineGroups[0]).getByLabelText('世帯メンバー(任意)')
    expect(memberSelect).toHaveValue(String(husband.id))
    expect(memberSelect).not.toBeDisabled()

    fireEvent.change(memberSelect, { target: { value: String(wife.id) } })
    expect(memberSelect).toHaveValue(String(wife.id))
  })

  it('科目に既定の世帯メンバーが設定されている明細行では、世帯メンバー選択がdisabledになり科目の既定値が表示される(計画Issue #88)', async () => {
    const husband = householdMemberRepository.create({ name: '夫' })
    const wallet = accountRepository.create({
      category: 'asset',
      name: '夫の財布',
      isReconcilable: false,
      householdMemberId: husband.id,
    })

    renderForm()
    const lineGroups = await screen.findAllByRole('group', { name: /行目/ })

    selectLineAccount(lineGroups[0], wallet.id)
    const memberSelect = within(lineGroups[0]).getByLabelText('世帯メンバー(任意)')

    expect(memberSelect).toBeDisabled()
    expect(memberSelect).toHaveValue(String(husband.id))
  })
})
