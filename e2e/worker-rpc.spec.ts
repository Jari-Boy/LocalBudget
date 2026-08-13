/**
 * Web Worker + RPC層(計画Issue #24)のE2Eテスト。
 * 実ブラウザ(Chromium)でVite dev serverを起動し、Worker生成・sql.js WASM読み込み・
 * Comlink RPC・ドメインエラーのシリアライズという、Node/Vitestでは再現できないブラウザ
 * 固有の統合動作を検証する(docs/architecture.md 10章)。UIコンポーネントは本Issueの
 * スコープ外のため、createDbClientをページ上で動的importして直接呼び出す形で検証する。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし、Vite dev serverはlocalhost)。
 */
import { test, expect } from '@playwright/test'

test.describe('Web Worker + RPC層', () => {
  test('Worker起動時にDBが初期化されマイグレーションが適用される', async ({ page }) => {
    await page.goto('/')

    const accounts = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      return client.account.findAll()
    })

    expect(accounts).toEqual([])
  })

  test('メインスレッドからRPC経由で10種類全てのRepositoryの主要メソッドを呼び出せる', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()

      const expenseAccount = await client.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      })
      const cashAccount = await client.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      })

      const budget = await client.budget.create({
        accountId: expenseAccount.id,
        yearMonth: '2026-08',
        amount: 30000,
      })
      const counterparty = await client.counterparty.create({ name: 'スーパー' })
      const householdMember = await client.householdMember.create({ name: '太郎' })
      const project = await client.project.create({ name: '旅行' })
      const recurringRule = await client.recurringTransactionRule.create({
        name: '家賃',
        debitAccountId: expenseAccount.id,
        creditAccountId: cashAccount.id,
        amount: 50000,
        frequency: 'monthly',
        dayOfMonth: 27,
      })
      const journalEntry = await client.journalEntry.create({
        entryDate: '2026-08-01',
        householdMemberId: householdMember.id,
        lines: [
          { accountId: expenseAccount.id, side: 'debit', amount: 1000 },
          { accountId: cashAccount.id, side: 'credit', amount: 1000 },
        ],
      })
      const externalTransactionRef = await client.externalTransactionRef.create({
        accountId: cashAccount.id,
        journalEntryId: journalEntry.id,
        externalId: 'ext-1',
        entryDate: '2026-08-01',
        description: 'test',
        amount: -1000,
      })
      const importMappingDefinition = await client.importMappingDefinition.create({
        formatGroupId: 'test-bank',
        label: 'テスト銀行',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
      })
      const draft = await client.journalEntryDraft.create({ entryDate: '2026-08-02' })

      return {
        account: (await client.account.findById(expenseAccount.id))?.name,
        budget: (await client.budget.findById(budget.id))?.amount,
        counterparty: (await client.counterparty.findById(counterparty.id))?.name,
        householdMember: (await client.householdMember.findById(householdMember.id))?.name,
        project: (await client.project.findById(project.id))?.name,
        recurringTransactionRule: (await client.recurringTransactionRule.findById(recurringRule.id))
          ?.name,
        journalEntry: (await client.journalEntry.findById(journalEntry.id))?.entryDate,
        externalTransactionRef: (
          await client.externalTransactionRef.findById(externalTransactionRef.id)
        )?.externalId,
        importMappingDefinition: (
          await client.importMappingDefinition.findById(importMappingDefinition.id)
        )?.label,
        journalEntryDraft: (await client.journalEntryDraft.findById(draft.id))?.entryDate,
      }
    })

    expect(result).toEqual({
      account: '食費',
      budget: 30000,
      counterparty: 'スーパー',
      householdMember: '太郎',
      project: '旅行',
      recurringTransactionRule: '家賃',
      journalEntry: '2026-08-01',
      externalTransactionRef: 'ext-1',
      importMappingDefinition: 'テスト銀行',
      journalEntryDraft: '2026-08-02',
    })
  })

  test('異なる集約由来のドメインエラー(journal/recurring-transaction)がinstanceofを保持したまま伝播する', async ({
    page,
  }) => {
    await page.goto('/')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const { UnbalancedJournalEntryError } = await import(
        '/src/domain/journal/UnbalancedJournalEntryError.ts'
      )
      const { InvalidRecurringScheduleError } = await import(
        '/src/domain/recurring-transaction/InvalidRecurringScheduleError.ts'
      )
      const client = await createDbClient()

      const expenseAccount = await client.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      })
      const cashAccount = await client.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      })
      const householdMember = await client.householdMember.create({ name: '太郎' })

      let journalError: unknown
      try {
        await client.journalEntry.create({
          entryDate: '2026-08-01',
          householdMemberId: householdMember.id,
          lines: [
            { accountId: expenseAccount.id, side: 'debit', amount: 1000 },
            { accountId: cashAccount.id, side: 'credit', amount: 900 },
          ],
        })
      } catch (e) {
        journalError = e
      }

      let recurringError: unknown
      try {
        await client.recurringTransactionRule.create({
          name: '不正なルール',
          debitAccountId: expenseAccount.id,
          creditAccountId: cashAccount.id,
          amount: 1000,
          frequency: 'weekly',
        })
      } catch (e) {
        recurringError = e
      }

      return {
        journalErrorIsUnbalanced: journalError instanceof UnbalancedJournalEntryError,
        journalErrorDebitTotal:
          journalError instanceof UnbalancedJournalEntryError ? journalError.debitTotal : null,
        recurringErrorIsInvalidSchedule: recurringError instanceof InvalidRecurringScheduleError,
      }
    })

    expect(result.journalErrorIsUnbalanced).toBe(true)
    expect(result.journalErrorDebitTotal).toBe(1000)
    expect(result.recurringErrorIsInvalidSchedule).toBe(true)
  })

  test('Worker側のDB接続でPRAGMA foreign_keys = ONが設定されている(存在しないaccountIdへの記帳を拒否する)', async ({
    page,
  }) => {
    await page.goto('/')

    const threwError = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      try {
        const householdMember = await client.householdMember.create({ name: '太郎' })
        await client.journalEntry.create({
          entryDate: '2026-08-01',
          householdMemberId: householdMember.id,
          lines: [
            { accountId: 999999, side: 'debit', amount: 100 },
            { accountId: 999999, side: 'credit', amount: 100 },
          ],
        })
        return false
      } catch {
        return true
      }
    })

    expect(threwError).toBe(true)
  })

  test('Worker初期化(WASM読み込み)が失敗した場合、createDbClientはハングせずrejectし、生成済みWorkerをterminateする', async ({
    page,
  }) => {
    await page.route('**/*.wasm', (route) => route.abort())
    await page.goto('/')

    let workerClosed = false
    page.on('worker', (worker) => {
      worker.on('close', () => {
        workerClosed = true
      })
    })

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      try {
        await createDbClient()
        return { rejected: false }
      } catch (error) {
        return { rejected: true, message: String(error) }
      }
    })

    expect(result.rejected).toBe(true)
    await expect.poll(() => workerClosed).toBe(true)
  })
})
