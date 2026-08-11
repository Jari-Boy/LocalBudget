// @vitest-environment jsdom
/**
 * CSV取込アップロード画面(計画Issue #76)のコンポーネントテスト。
 * 対象科目・マッピング定義の選択、CSVファイルのアップロード→パース→重複判定を経て
 * onUploadedへ結果を渡すフローと、列構成不一致時のエラー表示を、sql.jsのNode実装
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
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsExternalTransactionRefRepository } from '../../infrastructure/db/SqlJsExternalTransactionRefRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from './StatementImportUploadScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let importMappingDefinitionRepository: SqlJsImportMappingDefinitionRepository
let externalTransactionRefRepository: SqlJsExternalTransactionRefRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  importMappingDefinitionRepository = new SqlJsImportMappingDefinitionRepository(db)
  externalTransactionRefRepository = new SqlJsExternalTransactionRefRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(cleanup)

function renderScreen(onUploaded: (result: StatementImportUploadResult) => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <StatementImportUploadScreen
        accountRepository={accountRepository}
        importMappingDefinitionRepository={importMappingDefinitionRepository}
        externalTransactionRefRepository={externalTransactionRefRepository}
        onUploaded={onUploaded}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

function csvFile(content: string): File {
  return new File([content], 'statement.csv', { type: 'text/csv' })
}

describe('StatementImportUploadScreen', () => {
  it('対象科目の選択肢はasset/liabilityのアクティブな非システム管理科目のみ表示する', async () => {
    accountRepository.create({ category: 'asset', name: '普通預金', isReconcilable: true })
    accountRepository.create({ category: 'expense', name: '食費', isReconcilable: null })

    renderScreen(vi.fn())

    const select = await screen.findByLabelText('対象科目')
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(optionLabels).toContain('普通預金')
    expect(optionLabels).not.toContain('食費')
  })

  it('対象科目を選ぶと、その科目に使えるマッピング定義が選択肢に表示される', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'my-bank',
      label: 'マイ銀行 普通預金',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
      balanceColumn: '残高',
    })

    renderScreen(vi.fn())

    const accountSelect = await screen.findByLabelText('対象科目')
    fireEvent.change(accountSelect, { target: { value: String(account.id) } })

    const definitionSelect = await screen.findByLabelText('マッピング定義')
    await waitFor(() => {
      const optionLabels = Array.from(definitionSelect.querySelectorAll('option')).map(
        (o) => o.textContent,
      )
      expect(optionLabels).toContain('マイ銀行 普通預金')
    })
  })

  it('CSVファイルをアップロードすると、パース結果と重複判定を含む結果でonUploadedが呼ばれる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const definition = importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'my-bank',
      label: 'マイ銀行 普通預金',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
      balanceColumn: '残高',
    })

    const onUploaded = vi.fn()
    renderScreen(onUploaded)

    const accountSelect = await screen.findByLabelText('対象科目')
    fireEvent.change(accountSelect, { target: { value: String(account.id) } })

    const definitionSelect = await screen.findByLabelText('マッピング定義')
    await waitFor(() => {
      expect(definitionSelect).toHaveValue(String(definition.id))
    })

    const fileInput = screen.getByLabelText('CSVファイル')
    const file = csvFile('日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n2026/07/21,給与,250000,347000\n')
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const result = onUploaded.mock.calls[0][0] as StatementImportUploadResult
    expect(result.targetAccount.id).toBe(account.id)
    expect(result.definition.id).toBe(definition.id)
    expect(result.review.records).toHaveLength(2)
    expect(result.review.records[0].record.description).toBe('スーパー')
    expect(result.review.latestExternalBalance).toBe(347000)
  })

  it('マッピング定義とCSVの列構成が一致しない場合、エラーメッセージを表示しonUploadedを呼ばない', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'my-bank',
      label: 'マイ銀行 普通預金',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })

    const onUploaded = vi.fn()
    renderScreen(onUploaded)

    const accountSelect = await screen.findByLabelText('対象科目')
    fireEvent.change(accountSelect, { target: { value: String(account.id) } })
    await screen.findByLabelText('マッピング定義')

    const fileInput = screen.getByLabelText('CSVファイル')
    const file = csvFile('違う列1,違う列2\na,b\n')
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      '選択したマッピング定義とファイルの列構成が一致しません',
    )
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('既存の突合レコードと外部取引IDが一致する明細はisExactDuplicateとして結果に含まれる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    const definition = importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'my-bank',
      label: 'マイ銀行 普通預金',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
      externalIdColumn: '取引ID',
    })
    const entry = journalEntryRepository.create({
      entryDate: '2026-07-20',
      memo: 'スーパー',
      sourceType: 'external_import',
      lines: [
        { accountId: account.id, side: 'credit', amount: 3000 },
        { accountId: account.id, side: 'debit', amount: 3000 },
      ],
    })
    externalTransactionRefRepository.create({
      accountId: account.id,
      journalEntryId: entry.id,
      externalId: 'TX-001',
      entryDate: '2026-07-20',
      description: 'スーパー',
      amount: -3000,
    })

    const onUploaded = vi.fn()
    renderScreen(onUploaded)

    const accountSelect = await screen.findByLabelText('対象科目')
    fireEvent.change(accountSelect, { target: { value: String(account.id) } })
    const definitionSelect = await screen.findByLabelText('マッピング定義')
    await waitFor(() => expect(definitionSelect).toHaveValue(String(definition.id)))

    const fileInput = screen.getByLabelText('CSVファイル')
    const file = csvFile('日付,摘要,金額,取引ID\n2026/07/20,スーパー,-3000,TX-001\n')
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const result = onUploaded.mock.calls[0][0] as StatementImportUploadResult
    expect(result.review.records[0].isExactDuplicate).toBe(true)
  })
})
