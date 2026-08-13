// @vitest-environment jsdom
/**
 * CSV取込アップロード画面(計画Issue #76基盤・計画Issue #78でCSV先選択フローへ改修)の
 * コンポーネントテスト。対象科目を選んだ後、マッピング定義ではなくCSVファイルを先に選択でき、
 * アップロード時に対象科目で使える全マッピング定義候補へ実際にパースを試み(resolveMapping
 * DefinitionCandidates)、成功した候補が1件ならそのままレビュー一覧結果としてonUploadedへ渡し、
 * 複数あればユーザーに選ばせ、1件もなければエラー表示することを、sql.jsのNode実装
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
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsExternalTransactionRefRepository } from '../../infrastructure/db/SqlJsExternalTransactionRefRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import type { ExternalTransactionRef } from '../../domain/reconciliation/ExternalTransactionRef'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from './StatementImportUploadScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let importMappingDefinitionRepository: SqlJsImportMappingDefinitionRepository
let externalTransactionRefRepository: SqlJsExternalTransactionRefRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  importMappingDefinitionRepository = new SqlJsImportMappingDefinitionRepository(db)
  externalTransactionRefRepository = new SqlJsExternalTransactionRefRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
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

async function selectAccountAndUploadFile(accountId: number, content: string): Promise<void> {
  const accountSelect = await screen.findByLabelText('対象科目')
  fireEvent.change(accountSelect, { target: { value: String(accountId) } })

  const fileInput = await screen.findByLabelText('CSVファイル')
  fireEvent.change(fileInput, { target: { files: [csvFile(content)] } })

  fireEvent.click(screen.getByRole('button', { name: '取り込む' }))
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

  it('対象科目を選ぶと、マッピング定義ではなくCSVファイルの選択欄が表示される', async () => {
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

    renderScreen(vi.fn())

    const accountSelect = await screen.findByLabelText('対象科目')
    fireEvent.change(accountSelect, { target: { value: String(account.id) } })

    expect(await screen.findByLabelText('CSVファイル')).toBeInTheDocument()
    expect(screen.queryByLabelText('マッピング定義')).not.toBeInTheDocument()
  })

  it('アップロードしたファイルにパース成功する候補が1件のみの場合、自動的にレビュー結果でonUploadedが呼ばれる', async () => {
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

    await selectAccountAndUploadFile(
      account.id,
      '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n2026/07/21,給与,250000,347000\n',
    )

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const result = onUploaded.mock.calls[0][0] as StatementImportUploadResult
    expect(result.targetAccount.id).toBe(account.id)
    expect(result.definition.id).toBe(definition.id)
    expect(result.review.records).toHaveLength(2)
    expect(result.review.records[0].record.description).toBe('スーパー')
    expect(result.review.latestExternalBalance).toBe(347000)
  })

  it('パース成功する候補が複数ある場合、候補を選択でき、選んだ定義でonUploadedが呼ばれる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'bank-a',
      label: '銀行A形式',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })
    const definitionB = importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'bank-b',
      label: '銀行B形式',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })

    const onUploaded = vi.fn()
    renderScreen(onUploaded)

    await selectAccountAndUploadFile(account.id, '日付,摘要,金額\n2026/07/20,スーパー,-3000\n')

    const definitionSelect = await screen.findByLabelText('マッピング定義')
    const optionLabels = Array.from(definitionSelect.querySelectorAll('option')).map(
      (o) => o.textContent,
    )
    expect(optionLabels).toContain('銀行A形式')
    expect(optionLabels).toContain('銀行B形式')
    expect(onUploaded).not.toHaveBeenCalled()

    fireEvent.change(definitionSelect, { target: { value: String(definitionB.id) } })
    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const result = onUploaded.mock.calls[0][0] as StatementImportUploadResult
    expect(result.definition.id).toBe(definitionB.id)
  })

  it('複数候補から選択して確定する際、突合レコード取得の完了を待つ間は取り込むボタンが無効化される(連打による二重呼び出し防止)', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })
    importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'bank-a',
      label: '銀行A形式',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })
    const definitionB = importMappingDefinitionRepository.create({
      accountId: account.id,
      formatGroupId: 'bank-b',
      label: '銀行B形式',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })

    let resolveFindByAccount: (refs: ExternalTransactionRef[]) => void = () => {}
    const findByAccountPromise = new Promise<ExternalTransactionRef[]>((resolve) => {
      resolveFindByAccount = resolve
    })
    const delayedExternalTransactionRefRepository = {
      findByAccount: vi.fn(() => findByAccountPromise),
    }

    const onUploaded = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <StatementImportUploadScreen
          accountRepository={accountRepository}
          importMappingDefinitionRepository={importMappingDefinitionRepository}
          externalTransactionRefRepository={delayedExternalTransactionRefRepository}
          onUploaded={onUploaded}
          onBack={vi.fn()}
        />
      </I18nextProvider>,
    )

    await selectAccountAndUploadFile(account.id, '日付,摘要,金額\n2026/07/20,スーパー,-3000\n')

    const definitionSelect = await screen.findByLabelText('マッピング定義')
    fireEvent.change(definitionSelect, { target: { value: String(definitionB.id) } })

    const uploadButton = screen.getByRole('button', { name: '取り込む' })
    fireEvent.click(uploadButton)

    expect(uploadButton).toBeDisabled()
    fireEvent.click(uploadButton)
    expect(delayedExternalTransactionRefRepository.findByAccount).toHaveBeenCalledTimes(1)

    resolveFindByAccount([])
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
  })

  it('パースに成功する候補が1件もない場合、エラーメッセージを表示しonUploadedを呼ばない', async () => {
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

    await selectAccountAndUploadFile(account.id, '違う列1,違う列2\na,b\n')

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      '一致するマッピング定義が見つかりませんでした',
    )
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('マッピング定義')).not.toBeInTheDocument()
  })

  it('対象科目に使えるマッピング定義が1件も無い場合も、パース成功候補0件と同じエラー表示になる', async () => {
    const account = accountRepository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
    })

    const onUploaded = vi.fn()
    renderScreen(onUploaded)

    await selectAccountAndUploadFile(account.id, '日付,摘要,金額\n2026/07/20,スーパー,-3000\n')

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      '一致するマッピング定義が見つかりませんでした',
    )
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('既存の突合レコードと外部取引IDが一致する明細はisExactDuplicateとして結果に含まれる', async () => {
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
      externalIdColumn: '取引ID',
    })
    const entry = journalEntryRepository.create({
      entryDate: '2026-07-20',
      memo: 'スーパー',
      sourceType: 'external_import',
      householdMemberId: memberId,
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

    await selectAccountAndUploadFile(account.id, '日付,摘要,金額,取引ID\n2026/07/20,スーパー,-3000,TX-001\n')

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const result = onUploaded.mock.calls[0][0] as StatementImportUploadResult
    expect(result.review.records[0].isExactDuplicate).toBe(true)
  })
})
