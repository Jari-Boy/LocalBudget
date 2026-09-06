// @vitest-environment jsdom
/**
 * 割勘起票フォーム(計画Issue #40)のコンポーネントテスト。元の支出仕訳から、
 * 世帯メンバー間(docs/domain/expense-splitting.md 1.3節)・世帯外の相手との
 * 割勘(同1.4節)を単一フォームで起票できること、分担者の複数選択(世帯メンバー・
 * 世帯外相手の混在含む)、比率入力3モード(均等割/カスタム比率/金額直接指定、
 * 計画Issue #40の追加合意事項)、確定前の編集可能なプレビューを、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 人間レビューでの再指摘(計画Issue #40 Attempt 4)を受け、複数の元仕訳をまとめて
 * 選択して一括で割勘起票できることも検証する(originalEntries配列対応)。
 * さらに人間レビューでの追加指摘を受け、立替金(資産/負債)科目はseedAdvanceAccountsで
 * 自動投入された恒久的な科目を自動解決して使う(ユーザーによる選択UIを持たない)ことと、
 * 「割勘バッチ」ではなく既存のプロジェクト管理画面(D6)と同じ「プロジェクト」という
 * 用語で統一されていることも検証する。
 *
 * 再度の人間レビューでの指摘(相手の種類を明示的に選ばせるUIはナンセンスで、参加者の
 * 由来(世帯メンバーの一覧からチェック/世帯外相手として追加)自体がkindを一意に決める
 * べき)を受け、世帯メンバーは「相手の種類→相手」という2段階選択ではなく、割り振り
 * 可能な全員をチェックボックスの一覧として常時表示する形に変更したことも検証する。
 * 世帯外の相手は取引先マスタからの検索が必要な性質上、行を追加するパターンを維持するが、
 * 追加された行は常にkind='counterparty'であり「相手の種類」選択は行わない。
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
import { seedAdvanceAccounts } from '../../infrastructure/db/seedAdvanceAccounts'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { ExpenseSplittingForm } from './ExpenseSplittingForm'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

/** seedAdvanceAccounts投入後の立替金(資産)科目を取得する(仕訳明細のaccountId検証用) */
function findAdvanceAssetAccount() {
  const account = accountRepository.findAll().find((a) => a.category === 'asset' && a.isSystemManaged)
  if (account === undefined) throw new Error('立替金(資産)科目が投入されていません')
  return account
}

function renderForm(originalEntries: JournalEntry[], overrides?: { onComplete?: (entries: JournalEntry[]) => void }) {
  const onComplete = overrides?.onComplete ?? vi.fn()
  const onBack = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ExpenseSplittingForm
        originalEntries={originalEntries}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        journalEntryRepository={journalEntryRepository}
        onComplete={onComplete}
        onBack={onBack}
        today="2026-08-15"
      />
    </I18nextProvider>,
  )
  return { onComplete, onBack }
}

/** チェックボックスで世帯メンバーを分担者として選択する(名前がそのままチェックボックスのアクセシブルネームになる) */
function checkHouseholdMember(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name }))
}

/** 選択済みの世帯メンバー行(role=groupでaria-label=名前になっている)をスコープする */
function householdMemberRow(name: string) {
  return within(screen.getByRole('group', { name }))
}

describe('ExpenseSplittingForm', () => {
  it('世帯メンバー1人に均等割勘を起票すると、1件の割勘仕訳が作成される', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onComplete } = renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
    expect(createdEntries).toHaveLength(1)
    expect(createdEntries[0].lines).toHaveLength(4)
    // 一覧画面で元仕訳と割勘仕訳を区別できるよう、元の摘要から自動生成した摘要を持つ
    expect(createdEntries[0].memo).toBe('スーパーで食材購入の割勘')
    const links = journalEntryRepository.listLinksForEntry(createdEntries[0].id)
    expect(links).toEqual([
      expect.objectContaining({ fromEntryId: createdEntries[0].id, toEntryId: originalEntry.id, linkType: 'allocates', amount: 500 }),
    ])
  })

  it('世帯外の相手に割勘を起票すると、2行仕訳が作成される', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const friend = counterpartyRepository.create({ name: '友人Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '友人との食事',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('友人との食事')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })

    fireEvent.click(screen.getByRole('button', { name: '世帯外の相手を追加する' }))
    const participantRows = screen.getAllByRole('group', { name: /分担者/ })
    expect(participantRows).toHaveLength(1)
    fireEvent.change(within(participantRows[0]).getByLabelText('相手', { exact: true }), {
      target: { value: String(friend.id) },
    })

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(within(participantRows[0]).getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries).toHaveLength(1)
      expect(createdEntries[0].lines).toHaveLength(2)
    })
  })

  it('世帯メンバー2人をチェックして均等割勘すると、分担者ごとに独立した2件の仕訳が作成される(複数人対応。異なる分担者の立替金行を同じ仕訳に混在させると精算画面がタグを区別できなくなるため、統合は分担者単位に限定する)', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    householdMemberRepository.create({ name: 'Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8旅行割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '旅行の食事代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('旅行の食事代')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')
    checkHouseholdMember('Cさん')

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    // 1000円を立替者A・B・Cの3人で均等分割すると333円ずつになり、端数の1円は
    // 立替者Aに寄る(画面には表示されない)ため、分担者B・Cはいずれも333円になる
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(333))
    expect(householdMemberRow('Cさん').getByLabelText('金額')).toHaveValue(333)

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      // 分担者B・Cはそれぞれ独立した仕訳(4行)になる(異なる分担者の立替金行を
      // 同じ仕訳に混在させると精算画面がタグを区別できなくなるため統合しない)
      expect(createdEntries).toHaveLength(2)
      expect(createdEntries[0].lines).toHaveLength(4)
      expect(createdEntries[1].lines).toHaveLength(4)
      const allLinks = createdEntries.flatMap((entry) => journalEntryRepository.listLinksForEntry(entry.id))
      expect(allLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toEntryId: originalEntry.id, linkType: 'allocates', amount: 333 }),
          expect.objectContaining({ toEntryId: originalEntry.id, linkType: 'allocates', amount: 333 }),
        ]),
      )
    })
  })

  it('チェックを外すとその世帯メンバーは分担者から除外され、金額入力欄も消える', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    checkHouseholdMember('Bさん')
    expect(householdMemberRow('Bさん').getByLabelText('金額')).toBeInTheDocument()

    checkHouseholdMember('Bさん')
    expect(screen.queryByLabelText('金額')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Bさん' })).not.toBeChecked()
  })

  it('カスタム比率モードで按分すると、指定した比率どおりの金額で仕訳が作成される', async () => {
    seedAdvanceAccounts(db)
    const advanceAsset = findAdvanceAssetAccount()
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('配分方法'), { target: { value: 'ratio' } })
    checkHouseholdMember('Bさん')
    fireEvent.change(householdMemberRow('Bさん').getByLabelText('比率(%)'), { target: { value: '30' } })

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(300))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries).toHaveLength(1)
      const advanceLine = createdEntries[0].lines.find((line) => line.accountId === advanceAsset.id)
      expect(advanceLine?.amount).toBe(300)
    })
  })

  it('金額直接指定モードでは、入力した金額がそのまま使われる', async () => {
    seedAdvanceAccounts(db)
    const advanceAsset = findAdvanceAssetAccount()
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('配分方法'), { target: { value: 'amount' } })
    checkHouseholdMember('Bさん')
    fireEvent.change(householdMemberRow('Bさん').getByLabelText('金額'), { target: { value: '400' } })

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries).toHaveLength(1)
      const advanceLine = createdEntries[0].lines.find((line) => line.accountId === advanceAsset.id)
      expect(advanceLine?.amount).toBe(400)
    })
  })

  it('立替金(負債)科目が投入されていない場合、世帯メンバー分担者を含む確定はエラーになり仕訳は作成されない(自動投入が何らかの理由で欠けていた場合の安全策、世帯メンバー分担者の割勘が無警告で欠落することを防ぐ)', async () => {
    // seedAdvanceAccountsは呼ばず、資産側の立替金だけを手動で投入し、負債側が
    // 欠けている状況を意図的に再現する(通常のUI操作では発生しないが、防御的に検証する)
    accountRepository.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onComplete } = renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')
    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('立替金(負債)科目を選択してください')
    expect(onComplete).not.toHaveBeenCalled()
    expect(journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)).toHaveLength(0)
  })

  it('プロジェクトをその場で新規作成でき、作成したプロジェクトがそのまま選択された状態で割勘を起票できる', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('新しいプロジェクトの名前'), {
      target: { value: '26/8生活費割勘' },
    })
    fireEvent.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(screen.queryByLabelText('新しいプロジェクトの名前')).not.toBeInTheDocument())
    expect(projectRepository.findAll()).toHaveLength(1)
    expect(projectRepository.findAll()[0]).toMatchObject({ name: '26/8生活費割勘', kind: 'settlement' })

    checkHouseholdMember('Bさん')
    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries).toHaveLength(1)
    })
  })

  it('摘要欄には「元の摘要+の割勘」が既定値として入力されており、変更せず確定するとその既定値が使われる', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    expect(screen.getByLabelText('摘要')).toHaveValue('スーパーで食材購入の割勘')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')
    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries[0].memo).toBe('スーパーで食材購入の割勘')
    })
  })

  it('摘要欄を編集すると、確定時にその入力値が仕訳の摘要として使われる', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '旅行費用の割勘(自由記述)' } })
    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')
    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries[0].memo).toBe('旅行費用の割勘(自由記述)')
    })
  })

  it('複数の元仕訳を選択した場合、摘要欄には「N件の支出の割勘」が既定値として入力される', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '元仕訳1',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '元仕訳2',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderForm([entry1, entry2])
    await screen.findByText('元仕訳1')

    expect(screen.getByLabelText('摘要')).toHaveValue('2件の支出の割勘')
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onBack } = renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ExpenseSplittingForm(相手の選択UI)', () => {
  it('元仕訳の立替者は世帯メンバーのチェックボックス一覧から除外される(自分自身との割勘を防ぐ)', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    expect(screen.queryByRole('checkbox', { name: 'Aさん' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Bさん' })).toBeInTheDocument()
  })

  it('世帯メンバーの分担者を選ぶ画面に「相手の種類」という選択欄は存在しない', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('スーパーで食材購入')

    expect(screen.queryByLabelText('相手の種類')).not.toBeInTheDocument()
  })

  it('世帯メンバーと世帯外の相手を同時に選んで混在させ、均等割勘を起票できる(分担者ごとに独立した仕訳になる)', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const friend = counterpartyRepository.create({ name: '友人Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8旅行割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '旅行の食事代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('旅行の食事代')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')
    fireEvent.click(screen.getByRole('button', { name: '世帯外の相手を追加する' }))
    const counterpartyRows = screen.getAllByRole('group', { name: /分担者/ })
    fireEvent.change(within(counterpartyRows[0]).getByLabelText('相手', { exact: true }), {
      target: { value: String(friend.id) },
    })

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(333))
    expect(within(counterpartyRows[0]).getByLabelText('金額')).toHaveValue(333)

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      // 世帯メンバー分(4行)・世帯外相手分(2行)は異なる分担者のため独立した2件の仕訳になる
      expect(createdEntries).toHaveLength(2)
      const lineCounts = createdEntries.map((entry) => entry.lines.length).sort()
      expect(lineCounts).toEqual([2, 4])
    })
  })

  it('世帯外の相手をその場で新規に取引先として作成でき、作成した取引先がそのまま選択された状態で割勘を起票できる', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8旅行割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '旅行の食事代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    renderForm([originalEntry])
    await screen.findByText('旅行の食事代')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    fireEvent.click(screen.getByRole('button', { name: '世帯外の相手を追加する' }))
    const counterpartyRow = screen.getAllByRole('group', { name: /分担者/ })[0]

    fireEvent.change(within(counterpartyRow).getByLabelText('相手', { exact: true }), { target: { value: '__new__' } })
    fireEvent.change(within(counterpartyRow).getByLabelText('新しい取引先の名前'), {
      target: { value: '友人Cさん' },
    })
    fireEvent.click(within(counterpartyRow).getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(within(counterpartyRow).queryByLabelText('新しい取引先の名前')).not.toBeInTheDocument())
    expect(counterpartyRepository.findAll()).toHaveLength(1)
    expect(counterpartyRepository.findAll()[0]).toMatchObject({ name: '友人Cさん' })

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    await waitFor(() => expect(within(counterpartyRow).getByLabelText('金額')).toHaveValue(500))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)
      expect(createdEntries).toHaveLength(1)
    })
  })

  it('世帯外の相手の行を追加して相手を選択しないまま確定しようとすると、エラーになり仕訳は作成されない(相手未選択の行が無警告で送信対象から除外されることを防ぐ)', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8旅行割勘', kind: 'settlement' })
    const originalEntry = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '旅行の食事代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })

    const { onComplete } = renderForm([originalEntry])
    await screen.findByText('旅行の食事代')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    // 世帯メンバー分担者は正しく選ぶが、世帯外の相手の行は「相手」を未選択のまま金額だけ入力する
    fireEvent.change(screen.getByLabelText('配分方法'), { target: { value: 'amount' } })
    checkHouseholdMember('Bさん')
    fireEvent.change(householdMemberRow('Bさん').getByLabelText('金額'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: '世帯外の相手を追加する' }))
    const counterpartyRow = screen.getAllByRole('group', { name: /分担者/ })[0]
    fireEvent.change(within(counterpartyRow).getByLabelText('金額'), { target: { value: '300' } })

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('世帯外の相手を選択または新規作成してください')
    expect(onComplete).not.toHaveBeenCalled()
    expect(journalEntryRepository.findAll().filter((entry) => entry.id !== originalEntry.id)).toHaveLength(0)
  })
})

describe('ExpenseSplittingForm(複数の元仕訳をまとめて割勘する場合)', () => {
  it('選択した元仕訳がそれぞれ一覧表示され、均等割勘すると元仕訳ごとの按分を含む1件の複合仕訳にまとめて作成される(計画Issue #40の人間レビュー指摘への対応)', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'スーパーで食材購入1',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: 'スーパーで食材購入2',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    const { onComplete } = renderForm([entry1, entry2])
    await screen.findByText('スーパーで食材購入1')
    await screen.findByText('スーパーで食材購入2')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    checkHouseholdMember('Bさん')

    fireEvent.click(screen.getByRole('button', { name: '計算する' }))
    // 1000円を2等分した500円 + 500円を2等分した250円 = 750円が、元仕訳ごとに個別計算した
    // 合計額としてプレビューに表示される(単一の合計1500円を2等分した750円と偶然一致するが、
    // 各元仕訳の金額に対して個別に按分している点が異なる。次のテストで金額が異なる場合も検証)
    await waitFor(() => expect(householdMemberRow('Bさん').getByLabelText('金額')).toHaveValue(750))

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const createdEntries = journalEntryRepository
      .findAll()
      .filter((entry) => entry.id !== entry1.id && entry.id !== entry2.id)
    // 選択した元仕訳2件分の割勘が、独立した2件の仕訳ではなく1件の複合仕訳(4行×2=8行)にまとまる
    expect(createdEntries).toHaveLength(1)
    expect(createdEntries[0].lines).toHaveLength(8)

    const links = journalEntryRepository.listLinksForEntry(createdEntries[0].id)
    // 元仕訳ごとに独立したallocatesリンクを保持する(1件の仕訳から複数の元仕訳への一対多)
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toEntryId: entry1.id, linkType: 'allocates', amount: 500 }),
        expect.objectContaining({ toEntryId: entry2.id, linkType: 'allocates', amount: 250 }),
      ]),
    )
    expect(links).toHaveLength(2)
  })

  it('元仕訳ごとに金額が異なる場合でも、按分比率は共通のまま元仕訳ごとの金額に対して個別に計算される', async () => {
    seedAdvanceAccounts(db)
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    householdMemberRepository.create({ name: 'Bさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26/8生活費割勘', kind: 'settlement' })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '外食代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 2000 },
        { accountId: cash.id, side: 'credit', amount: 2000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '日用品代',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 300 },
        { accountId: cash.id, side: 'credit', amount: 300 },
      ],
    })

    renderForm([entry1, entry2])
    await screen.findByText('外食代')
    await screen.findByText('日用品代')

    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    fireEvent.change(screen.getByLabelText('配分方法'), { target: { value: 'ratio' } })
    checkHouseholdMember('Bさん')
    fireEvent.change(householdMemberRow('Bさん').getByLabelText('比率(%)'), { target: { value: '30' } })

    fireEvent.click(screen.getByRole('button', { name: '割勘を確定する' }))

    await waitFor(() => {
      const createdEntries = journalEntryRepository
        .findAll()
        .filter((entry) => entry.id !== entry1.id && entry.id !== entry2.id)
      expect(createdEntries).toHaveLength(1)
      const links = journalEntryRepository.listLinksForEntry(createdEntries[0].id)
      // 30%の比率は共通のまま、元仕訳自身の金額(2000円・300円)に対して個別に適用され、
      // 元仕訳ごとに独立したallocatesリンクとして1件の仕訳にまとまる
      expect(links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toEntryId: entry1.id, amount: 600 }),
          expect.objectContaining({ toEntryId: entry2.id, amount: 90 }),
        ]),
      )
      expect(links).toHaveLength(2)
    })
  })

  it('配分方法に「金額を直接指定する」の選択肢が表示されず、「按分する金額」欄も表示されない(元仕訳ごとに金額が異なり単一の直接指定ができないため)', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: '元仕訳1',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: '元仕訳2',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderForm([entry1, entry2])
    await screen.findByText('元仕訳1')

    expect(screen.queryByLabelText('按分する金額')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('配分方法')).queryByText('金額を直接指定する')).not.toBeInTheDocument()
  })

  it('元仕訳ごとに立替者(householdMemberId)が異なる場合、いずれの立替者も世帯メンバーのチェックボックス一覧から除外される(自分自身との割勘を防ぐ)', async () => {
    const memberA = householdMemberRepository.create({ name: 'Aさん' })
    const memberB = householdMemberRepository.create({ name: 'Bさん' })
    householdMemberRepository.create({ name: 'Cさん' })
    const expense = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const entry1 = journalEntryRepository.create({
      entryDate: '2026-08-01',
      memo: 'Aさん立替の元仕訳',
      householdMemberId: memberA.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 1000 },
        { accountId: cash.id, side: 'credit', amount: 1000 },
      ],
    })
    const entry2 = journalEntryRepository.create({
      entryDate: '2026-08-02',
      memo: 'Bさん立替の元仕訳',
      householdMemberId: memberB.id,
      lines: [
        { accountId: expense.id, side: 'debit', amount: 500 },
        { accountId: cash.id, side: 'credit', amount: 500 },
      ],
    })

    renderForm([entry1, entry2])
    await screen.findByText('Aさん立替の元仕訳')

    expect(screen.queryByRole('checkbox', { name: 'Aさん' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Bさん' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Cさん' })).toBeInTheDocument()
  })
})
