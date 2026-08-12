// @vitest-environment jsdom
/**
 * CSV取込レビュー一覧画面(計画Issue #76)のコンポーネントテスト。
 * アップロード済みのレコード一覧の表示、相手科目の手動選択、重複防止フロー
 * (docs/domain/statement-import.md 1.6)の警告表示・ユーザー選択(完全一致重複の
 * 明示的な取込許可、確定版候補の「これは確定版です」/「別の取引です」選択)、
 * 残高照合(docs/domain/reconciliation.md 1.5、is_reconcilable=true科目のみ)の
 * 警告表示を、sql.jsのNode実装(createTestDatabase)を使った統合的なレンダリング
 * テストとして検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import type { StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import type { ImportedRecord } from '../../domain/statement-import/ImportedRecord'
import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'
import { StatementImportReviewScreen } from './StatementImportReviewScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let projectRepository: SqlJsProjectRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
})

afterEach(cleanup)

function importedRecord(overrides: Partial<ImportedRecord> = {}): ImportedRecord {
  return {
    entryDate: '2026-07-20',
    description: 'スーパー',
    amount: -3000,
    balanceAfter: 97000,
    externalId: 'TX-001',
    isSettled: null,
    ...overrides,
  }
}

function renderScreen(
  targetAccount: ReturnType<SqlJsAccountRepository['create']>,
  review: StatementImportReviewResult,
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <StatementImportReviewScreen
        targetAccount={targetAccount}
        review={review}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        counterpartyRepository={counterpartyRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('StatementImportReviewScreen', () => {
  it('各レコードが一覧表示され、相手科目を手動選択できる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord(),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    expect(within(group).getByText('スーパー')).toBeInTheDocument()
    const counterSelect = within(group).getByLabelText('相手科目')
    expect(within(counterSelect).getByText('食費')).toBeInTheDocument()
  })

  it('完全一致重複のレコードは警告が表示され、既定では取込対象外(チェック未選択)である', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord(),
          externalId: 'TX-001',
          isExactDuplicate: true,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    expect(within(group).getByText('取込済みの可能性がある明細です。')).toBeInTheDocument()
    const includeCheckbox = within(group).getByLabelText('それでも取り込む') as HTMLInputElement
    expect(includeCheckbox.checked).toBe(false)
  })

  it('確定版候補があるレコードには「これは確定版です」「別の取引です」の選択肢が表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord(),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [{ journalEntryId: 42, entryDate: '2026-07-18', amount: -2990, isSettled: false }],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    expect(within(group).getByText('日付・金額が近い明細が既にあります。確定版の可能性があります。')).toBeInTheDocument()
    expect(within(group).getByLabelText('これは確定版です')).toBeInTheDocument()
    expect(within(group).getByLabelText('別の取引です')).toBeInTheDocument()
  })

  it('is_reconcilable=trueの対象科目で帳簿残高と外部残高が一致しない場合、警告バナーが表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 100000 },
        {
          accountId: accountRepository.create({
            category: 'equity',
            name: '初期残高',
            isReconcilable: null,
            isSystemManaged: true,
          }).id,
          side: 'credit',
          amount: 100000,
        },
      ],
    })

    const review: StatementImportReviewResult = {
      records: [],
      latestExternalBalance: 90000,
    }

    renderScreen(account, review)

    await screen.findByText(/帳簿残高.*と外部残高.*が一致しません/)
  })

  it('is_reconcilable=falseの対象科目(クレジットカード)では残高照合セクション自体を表示しない', async () => {
    const account = accountRepository.create({
      category: 'liability',
      name: '楽天カード',
      isReconcilable: false,
    })

    const review: StatementImportReviewResult = {
      records: [],
      latestExternalBalance: 90000,
    }

    renderScreen(account, review)

    await screen.findByText('取り込み対象の明細がありません')
    expect(screen.queryByText(/帳簿残高/)).not.toBeInTheDocument()
  })

  it('帳簿残高と外部残高が一致する場合は一致している旨を表示する', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const equityAccount = accountRepository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 90000 },
        { accountId: equityAccount.id, side: 'credit', amount: 90000 },
      ],
    })

    const review: StatementImportReviewResult = { records: [], latestExternalBalance: 90000 }

    renderScreen(account, review)

    await screen.findByText('帳簿残高と外部残高は一致しています。')
  })

  it('今回アップロードしたCSVバッチ自身の効果を含めて帳簿残高を計算する(docs/domain/reconciliation.md 1.5「今回取り込む分の草案」)', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const equityAccount = accountRepository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 100000 },
        { accountId: equityAccount.id, side: 'credit', amount: 100000 },
      ],
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ amount: -3000, balanceAfter: 97000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: 97000,
    }

    renderScreen(account, review)

    await screen.findByText('帳簿残高と外部残高は一致しています。')
  })

  it('完全一致重複でチェックが入っていない行は帳簿残高の計算から除外される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const equityAccount = accountRepository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 100000 },
        { accountId: equityAccount.id, side: 'credit', amount: 100000 },
      ],
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ amount: -3000, balanceAfter: 97000 }),
          externalId: 'TX-001',
          isExactDuplicate: true,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: 100000,
    }

    renderScreen(account, review)

    await screen.findByText('帳簿残高と外部残高は一致しています。')
  })

  it('相手科目の候補にはis_reconcilable=true科目(口座間振替、external_importはis_reconcilable制限のホワイトリストに含まれる)も表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord(),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    const counterSelect = within(group).getByLabelText('相手科目')
    expect(within(counterSelect).getByText('証券口座')).toBeInTheDocument()
  })

  it('対象科目自身は相手科目の候補から除外される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord(),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    const counterSelect = within(group).getByLabelText('相手科目')
    expect(within(counterSelect).queryByText('普通預金')).not.toBeInTheDocument()
  })

  it('確定版候補で「これは確定版です」を選択すると、置き換え対象の旧仕訳を残高計算から除外し二重計上しない', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const equityAccount = accountRepository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })
    journalEntryRepository.create({
      entryDate: '2026-07-01',
      sourceType: 'initial_balance',
      lines: [
        { accountId: account.id, side: 'debit', amount: 100000 },
        { accountId: equityAccount.id, side: 'credit', amount: 100000 },
      ],
    })
    // 速報時点の旧仕訳(海外通販、-2990)。確定後は摘要・金額が変わり-3000になる想定
    const preliminaryEntry = journalEntryRepository.create({
      entryDate: '2026-07-18',
      memo: '海外通販(速報)',
      sourceType: 'external_import',
      lines: [
        { accountId: account.id, side: 'credit', amount: 2990 },
        { accountId: equityAccount.id, side: 'debit', amount: 2990 },
      ],
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '海外通販(確定)', amount: -3000, balanceAfter: 97000 }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [
            { journalEntryId: preliminaryEntry.id, entryDate: '2026-07-18', amount: -2990, isSettled: false },
          ],
        },
      ],
      latestExternalBalance: 97000,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.click(within(group).getByLabelText('これは確定版です'))

    await screen.findByText('帳簿残高と外部残高は一致しています。')
  })

  it('取引先推定・相手科目サジェストの結果が初期値として表示され、取引先はユーザーが変更できる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const otherAccount = accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })
    const counterparty = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    counterpartyRepository.addPattern(counterparty.id, 'イオン')
    const otherCounterparty = counterpartyRepository.create({ name: '映画館' })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    const counterpartySelect = within(group).getByLabelText('取引先') as HTMLSelectElement
    expect(counterpartySelect.value).toBe(String(counterparty.id))
    const counterAccountSelect = within(group).getByLabelText('相手科目') as HTMLSelectElement
    expect(counterAccountSelect.value).toBe(String(foodAccount.id))

    fireEvent.change(counterpartySelect, { target: { value: String(otherCounterparty.id) } })
    expect(counterAccountSelect.value).toBe('')

    fireEvent.change(counterAccountSelect, { target: { value: String(otherAccount.id) } })
    expect(counterAccountSelect.value).toBe(String(otherAccount.id))
  })

  it('相手科目を手動編集した後は、取引先を変更しても相手科目が自動上書きされない', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const manualAccount = accountRepository.create({ category: 'expense', name: '日用品', isReconcilable: null })
    const counterpartyA = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    counterpartyRepository.addPattern(counterpartyA.id, 'イオン')
    const counterpartyB = counterpartyRepository.create({ name: 'イトーヨーカドー' })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    const counterpartySelect = within(group).getByLabelText('取引先') as HTMLSelectElement
    const counterAccountSelect = within(group).getByLabelText('相手科目') as HTMLSelectElement
    expect(counterAccountSelect.value).toBe(String(foodAccount.id))

    fireEvent.change(counterAccountSelect, { target: { value: String(manualAccount.id) } })
    fireEvent.change(counterpartySelect, { target: { value: String(counterpartyB.id) } })

    expect(counterpartySelect.value).toBe(String(counterpartyB.id))
    expect(counterAccountSelect.value).toBe(String(manualAccount.id))
  })

  it('取引先が推定できない場合、取引先・相手科目とも未選択で表示され手動選択できる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    const counterpartySelect = within(group).getByLabelText('取引先') as HTMLSelectElement
    const counterAccountSelect = within(group).getByLabelText('相手科目') as HTMLSelectElement
    expect(counterpartySelect.value).toBe('')
    expect(counterAccountSelect.value).toBe('')
  })

  it('取引先未特定の同一摘要レコードが複数件ある場合、一括割当てのバナーが表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-20' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-21' }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    expect(
      screen.getByText('同じ摘要の明細が2件あります。まとめて取引先/相手科目を割り当てますか?'),
    ).toBeInTheDocument()
  })

  it('同じ摘要のレコードが1件のみの場合、一括割当てのバナーは表示されない', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗A' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗B' }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    expect(screen.queryByText(/まとめて取引先/)).not.toBeInTheDocument()
  })

  it('一括割当てバナーで取引先を選び適用すると、グループ内の全レコードに反映されバナーが消える', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const counterparty = counterpartyRepository.create({ name: '謎の店舗', defaultAccountId: foodAccount.id })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-20' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-21' }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    const bulkSelect = screen.getByLabelText('一括割当ての取引先') as HTMLSelectElement
    fireEvent.change(bulkSelect, { target: { value: String(counterparty.id) } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて割り当てる' }))

    const group1 = screen.getByRole('group', { name: '1件目' })
    const group2 = screen.getByRole('group', { name: '2件目' })
    expect((within(group1).getByLabelText('取引先') as HTMLSelectElement).value).toBe(String(counterparty.id))
    expect((within(group1).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(foodAccount.id))
    expect((within(group2).getByLabelText('取引先') as HTMLSelectElement).value).toBe(String(counterparty.id))
    expect((within(group2).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(foodAccount.id))
    expect(screen.queryByText(/まとめて取引先/)).not.toBeInTheDocument()
  })

  it('一括割当て適用後も、個別レコードの相手科目を上書き編集できる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const otherAccount = accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })
    const counterparty = counterpartyRepository.create({ name: '謎の店舗', defaultAccountId: foodAccount.id })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-20' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-21' }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(screen.getByLabelText('一括割当ての取引先'), { target: { value: String(counterparty.id) } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて割り当てる' }))

    const group2 = screen.getByRole('group', { name: '2件目' })
    const counterAccountSelect2 = within(group2).getByLabelText('相手科目') as HTMLSelectElement
    fireEvent.change(counterAccountSelect2, { target: { value: String(otherAccount.id) } })
    expect(counterAccountSelect2.value).toBe(String(otherAccount.id))

    const group1 = screen.getByRole('group', { name: '1件目' })
    expect((within(group1).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(foodAccount.id))
  })

  it('確定操作を行うと、対象レコードの仕訳(journal_entries/journal_lines)が作成される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'スーパー', amount: -3000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].memo).toBe('スーパー')
    expect(entries[0].sourceType).toBe('external_import')
  })

  it('完全一致重複で取込対象外(チェック未選択)のレコードは確定対象から除外される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '取込済み明細' }),
          externalId: 'TX-001',
          isExactDuplicate: true,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: 'スーパー', amount: -1500 }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group2 = await screen.findByRole('group', { name: '2件目' })
    fireEvent.change(within(group2).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].memo).toBe('スーパー')
  })

  it('相手科目が未選択のレコードは失敗として報告され、他のレコードの確定は続行される(継続処理方式)', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'スーパー', amount: -1000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗', amount: -2000 }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group1 = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group1).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    // 2件目は相手科目未選択のまま確定操作を行う
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(1件失敗)')
    expect(within(screen.getByRole('alert')).getByText(/2件目/)).toBeInTheDocument()

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].memo).toBe('スーパー')
  })

  it('取引先が推定できなかったレコードを手動確定すると、取引先パターンが学習される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const counterparty = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    // 事前にパターンを登録しないため、estimateCounterpartyはnullを返す想定

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('取引先'), { target: { value: String(counterparty.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const learnedPatterns = counterpartyRepository.findByPattern(normalizeDescriptionForMatching('イオン○○店'))
    expect(learnedPatterns.some((pattern) => pattern.counterpartyId === counterparty.id)).toBe(true)
  })

  it('取引先が自動推定済みだったレコードを確定しても、取引先パターンは重複登録されない', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const counterparty = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    counterpartyRepository.addPattern(counterparty.id, 'イオン')

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const patternsAfter = counterpartyRepository.findByPattern(normalizeDescriptionForMatching('イオン○○店'))
    expect(patternsAfter).toHaveLength(1)
  })

  it('「これは確定版です」を選んだレコードを確定すると、置き換え対象の旧仕訳が削除される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const funAccount = accountRepository.create({ category: 'expense', name: '娯楽費', isReconcilable: null })
    const preliminaryEntry = journalEntryRepository.create({
      entryDate: '2026-07-18',
      memo: '海外通販(速報)',
      sourceType: 'external_import',
      lines: [
        { accountId: account.id, side: 'credit', amount: 2990 },
        { accountId: funAccount.id, side: 'debit', amount: 2990 },
      ],
    })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '海外通販(確定)', amount: -3000 }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [
            { journalEntryId: preliminaryEntry.id, entryDate: '2026-07-18', amount: -2990, isSettled: false },
          ],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.click(within(group).getByLabelText('これは確定版です'))
    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(funAccount.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries.some((entry) => entry.memo === '海外通販(速報)')).toBe(false)
    expect(entries.some((entry) => entry.memo === '海外通販(確定)')).toBe(true)
  })

  it('相手科目が未選択、またはPL科目(収益・費用)の場合は取引先セレクトが表示される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'スーパー' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    expect(within(group).queryByLabelText('取引先')).toBeInTheDocument()

    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    expect(within(group).queryByLabelText('取引先')).toBeInTheDocument()
  })

  it('相手科目に非PL科目(資産・負債)を選択すると取引先セレクトが非表示になり、取引先の選択はクリアされる', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const savingsAccount = accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })
    const counterparty = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    counterpartyRepository.addPattern(counterparty.id, 'イオン')

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    expect((within(group).getByLabelText('取引先') as HTMLSelectElement).value).toBe(String(counterparty.id))

    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(savingsAccount.id) } })
    expect(within(group).queryByLabelText('取引先')).not.toBeInTheDocument()

    // 資産科目からPL科目へ戻すと取引先セレクトが再表示され、値はクリアされている(暗黙の再選択を防ぐ)
    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    expect((within(group).getByLabelText('取引先') as HTMLSelectElement).value).toBe('')
  })

  it('取引先が設定された状態で相手科目を非PL科目に変更してから確定すると、取引先なしで仕訳が作成される(TRIGGER違反を起こさない)', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const savingsAccount = accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })
    const counterparty = counterpartyRepository.create({ name: 'イオン', defaultAccountId: foodAccount.id })
    counterpartyRepository.addPattern(counterparty.id, 'イオン')

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'イオン○○店', amount: -3000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(savingsAccount.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].lines.every((line) => line.counterpartyId === null)).toBe(true)
  })

  it('プロジェクト・世帯メンバーを確認・修正でき、確定操作でjournal_linesに反映される', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const foodAccount = accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })
    const project = projectRepository.create({ name: '沖縄旅行' })
    const member = householdMemberRepository.create({ name: '太郎' })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: 'スーパー', amount: -3000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('相手科目'), { target: { value: String(foodAccount.id) } })
    fireEvent.change(within(group).getByLabelText('プロジェクト'), { target: { value: String(project.id) } })
    fireEvent.change(within(group).getByLabelText('世帯メンバー'), { target: { value: String(member.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    const counterLine = entries[0].lines.find((line) => line.accountId === foodAccount.id)
    expect(counterLine?.projectId).toBe(project.id)
    expect(counterLine?.householdMemberId).toBe(member.id)
  })

  it('取引先セレクトでdefault_account_idが非PL科目(資産・負債)の取引先を選択すると、相手科目は追従するが取引先セレクトは非表示になりクリアされる', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const savingsAccount = accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })
    // docs/domain/counterparties.md 1.4の通りdefault_account_idはあくまで初期値でありPL科目
    // への制約はドメイン上存在しないため、資産科目を指す取引先も正規のケースとして起こりうる
    const counterparty = counterpartyRepository.create({ name: '証券会社', defaultAccountId: savingsAccount.id })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '証券会社入金' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('取引先'), { target: { value: String(counterparty.id) } })

    expect((within(group).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(savingsAccount.id))
    expect(within(group).queryByLabelText('取引先')).not.toBeInTheDocument()
  })

  it('取引先セレクトで非PL科目をdefault_account_idに持つ取引先を選択した状態のまま確定しても、取引先なしで仕訳が作成される(TRIGGER違反を起こさない)', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const savingsAccount = accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })
    const counterparty = counterpartyRepository.create({ name: '証券会社', defaultAccountId: savingsAccount.id })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '証券会社入金', amount: 5000 }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    const group = await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(within(group).getByLabelText('取引先'), { target: { value: String(counterparty.id) } })
    fireEvent.click(screen.getByRole('button', { name: '確定する' }))

    await screen.findByText('1件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].lines.every((line) => line.counterpartyId === null)).toBe(true)
  })

  it('一括割当てでdefault_account_idが非PL科目の取引先を適用すると、相手科目は反映されるが取引先は設定されない', async () => {
    const account = accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    const savingsAccount = accountRepository.create({ category: 'asset', name: '証券口座', isReconcilable: true })
    const counterparty = counterpartyRepository.create({ name: '証券会社', defaultAccountId: savingsAccount.id })

    const review: StatementImportReviewResult = {
      records: [
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-20' }),
          externalId: 'TX-001',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
        {
          record: importedRecord({ description: '謎の店舗', entryDate: '2026-07-21' }),
          externalId: 'TX-002',
          isExactDuplicate: false,
          approximateCandidates: [],
        },
      ],
      latestExternalBalance: null,
    }

    renderScreen(account, review)

    await screen.findByRole('group', { name: '1件目' })
    fireEvent.change(screen.getByLabelText('一括割当ての取引先'), { target: { value: String(counterparty.id) } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて割り当てる' }))

    const group1 = screen.getByRole('group', { name: '1件目' })
    const group2 = screen.getByRole('group', { name: '2件目' })
    expect((within(group1).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(savingsAccount.id))
    expect((within(group2).getByLabelText('相手科目') as HTMLSelectElement).value).toBe(String(savingsAccount.id))
    expect(within(group1).queryByLabelText('取引先')).not.toBeInTheDocument()
    expect(within(group2).queryByLabelText('取引先')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確定する' }))
    await screen.findByText('2件を確定しました(0件失敗)')

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.lines.every((line) => line.counterpartyId === null))).toBe(true)
  })
})
