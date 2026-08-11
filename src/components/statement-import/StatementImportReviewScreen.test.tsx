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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import type { StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import type { ImportedRecord } from '../../domain/statement-import/ImportedRecord'
import { StatementImportReviewScreen } from './StatementImportReviewScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
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
})
