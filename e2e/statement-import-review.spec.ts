/**
 * CSV取込〜レビュー一覧の基盤(計画Issue #76、docs/domain/statement-import.md 1.5・1.6、
 * docs/domain/reconciliation.md 1.5)のE2Eテスト。実ブラウザ(Chromium)でトップ画面から
 * CSV取込アップロード画面・レビュー一覧画面を操作し、Web Worker + RPC層を経由して
 * 対象科目・マッピング定義の選択、CSVアップロード→レビュー一覧遷移、列構成不一致時の
 * エラー表示、外部取引IDの完全一致重複警告、確定版候補の提示・選択、残高照合警告の
 * 表示を検証する。account-registration.spec.ts・journal-entry.spec.tsと同様、
 * 事前データ準備はpage.evaluate内で新規に作成したWorkerで行い、autoSave.flush()で
 * 即座に永続化してからreloadし、アプリ側のWorkerにIndexedDB経由で反映させる。
 */
import { test, expect, type Page } from '@playwright/test'

interface AccountInput {
  category: string
  name: string
  isReconcilable: boolean | null
}

interface MappingDefinitionInput {
  /** accountsのうち、このマッピング定義を紐づける対象科目のインデックス */
  accountIndex: number
  formatGroupId: string
  label: string
  dateColumn: string
  dateFormat: string
  descriptionColumn: string
  amountMode: string
  amountColumn?: string
  balanceColumn?: string
  externalIdColumn?: string
}

/**
 * 対象科目・相手科目候補・マッピング定義をまとめて1つのWorkerで作成し、flush()で
 * 即座にIndexedDBへ永続化してからreloadする(journal-entry.spec.tsのsetupAccountsAndReloadと
 * 同じ「複数レコードを単一Worker内でまとめて作成する」パターン)。作成した対象科目のidを
 * 返す(相手科目のidが必要な確定版候補・重複データのセットアップで使う)。
 */
async function setupAccountsAndMapping(
  page: Page,
  accounts: AccountInput[],
  mapping: MappingDefinitionInput,
): Promise<number[]> {
  const accountIds = await page.evaluate(
    async ({ accountInputs, mapping }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const ids: number[] = []
      for (const input of accountInputs) {
        const created = await client.account.create(input)
        ids.push(created.id)
      }
      const { accountIndex, ...mappingFields } = mapping
      await client.importMappingDefinition.create({ ...mappingFields, accountId: ids[accountIndex] })
      await client.autoSave.flush()
      return ids
    },
    { accountInputs: accounts, mapping },
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  return accountIds
}

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8')
}

async function startUpload(page: Page, accountName: string) {
  await page.getByRole('button', { name: '明細を取り込む' }).click()
  await page.getByLabel('対象科目').selectOption({ label: accountName })
}

test.describe('CSV取込〜レビュー一覧', () => {
  test('対象科目・マッピング定義を選びCSVをアップロードするとレビュー一覧へ遷移し、相手科目を手動選択できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'expense', name: '食費', isReconcilable: null },
      ],
      {
        accountIndex: 0,
        formatGroupId: 'test-bank',
        label: 'テスト銀行 普通預金',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
        balanceColumn: '残高',
      },
    )

    await startUpload(page, '普通預金')
    await expect(page.getByLabel('マッピング定義')).toHaveValue(/.+/)

    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    const group = page.getByRole('group', { name: '1件目' })
    await expect(group.getByText('スーパー')).toBeVisible()
    await group.getByLabel('相手科目').selectOption({ label: '食費' })
    await expect(group.getByLabel('相手科目')).toHaveValue(/.+/)
  })

  test('マッピング定義とCSVの列構成が一致しない場合、エラーメッセージが表示され取込が進まない', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndMapping(page, [{ category: 'asset', name: '普通預金', isReconcilable: true }], {
      accountIndex: 0,
      formatGroupId: 'test-bank',
      label: 'テスト銀行 普通預金',
      dateColumn: '日付',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '摘要',
      amountMode: 'single_signed',
      amountColumn: '金額',
    })

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('違う列1,違う列2\na,b\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('alert')).toContainText('列構成が一致しません')
    await expect(page.getByRole('heading', { name: '明細のレビュー' })).not.toBeVisible()
  })

  test('外部取引IDが完全一致する明細は取込済みの可能性がある警告が表示され、既定では取込対象外のままである', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const [targetAccountId, counterAccountId] = await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'expense', name: '食費', isReconcilable: null },
      ],
      {
        accountIndex: 0,
        formatGroupId: 'test-bank',
        label: 'テスト銀行 普通預金',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
        externalIdColumn: '取引ID',
      },
    )

    await page.evaluate(
      async ({ targetAccountId: accountId, counterAccountId: counterId }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        await client.journalEntry.create({
          entryDate: '2026-07-20',
          memo: 'スーパー',
          sourceType: 'external_import',
          lines: [
            { accountId, side: 'credit', amount: 3000 },
            { accountId: counterId, side: 'debit', amount: 3000 },
          ],
          externalTransactionRef: {
            accountId,
            externalId: 'TX-001',
            entryDate: '2026-07-20',
            description: 'スーパー',
            amount: -3000,
          },
        })
        await client.autoSave.flush()
      },
      { targetAccountId, counterAccountId },
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額,取引ID\n2026/07/20,スーパー,-3000,TX-001\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    const group = page.getByRole('group', { name: '1件目' })
    await expect(group.getByText('取込済みの可能性がある明細です。')).toBeVisible()
    await expect(group.getByLabel('それでも取り込む')).not.toBeChecked()
    await group.getByLabel('それでも取り込む').check()
    await expect(group.getByLabel('それでも取り込む')).toBeChecked()
  })

  test('日付・金額が近い既存明細がある場合、確定版候補として提示され「これは確定版です」を選択できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const [targetAccountId, counterAccountId] = await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '楽天カード引落口座', isReconcilable: true },
        { category: 'expense', name: '娯楽費', isReconcilable: null },
      ],
      {
        accountIndex: 0,
        formatGroupId: 'test-card',
        label: 'テストカード',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
      },
    )

    await page.evaluate(
      async ({ targetAccountId: accountId, counterAccountId: counterId }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        await client.journalEntry.create({
          entryDate: '2026-07-18',
          memo: '海外通販(速報)',
          sourceType: 'external_import',
          lines: [
            { accountId, side: 'credit', amount: 2990 },
            { accountId: counterId, side: 'debit', amount: 2990 },
          ],
          externalTransactionRef: {
            accountId,
            externalId: 'TX-PRELIM-1',
            entryDate: '2026-07-18',
            description: '海外通販(速報)',
            amount: -2990,
            isSettled: false,
          },
        })
        await client.autoSave.flush()
      },
      { targetAccountId, counterAccountId },
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await startUpload(page, '楽天カード引落口座')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額\n2026/07/20,海外通販(確定),-3010\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    const group = page.getByRole('group', { name: '1件目' })
    await expect(
      group.getByText('日付・金額が近い明細が既にあります。確定版の可能性があります。'),
    ).toBeVisible()
    await expect(group.getByLabel('これは確定版です')).toBeVisible()
    await expect(group.getByLabel('別の取引です')).toBeVisible()
    await group.getByLabel('これは確定版です').check()
    await expect(group.getByLabel('これは確定版です')).toBeChecked()
  })

  test('確定版候補で「これは確定版です」を選択すると、置き換え対象の旧仕訳を残高照合の計算から除外し二重計上しない', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const [targetAccountId] = await setupAccountsAndMapping(
      page,
      [{ category: 'asset', name: '普通預金', isReconcilable: true }],
      {
        accountIndex: 0,
        formatGroupId: 'test-bank',
        label: 'テスト銀行 普通預金',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
        balanceColumn: '残高',
      },
    )

    await page.evaluate(async ({ targetAccountId: accountId }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const equityAccount = await client.account.create({
        category: 'equity',
        name: '普通預金の初期残高',
        isReconcilable: null,
        isSystemManaged: true,
      })
      await client.journalEntry.create({
        entryDate: '2026-07-01',
        sourceType: 'initial_balance',
        lines: [
          { accountId, side: 'debit', amount: 100000 },
          { accountId: equityAccount.id, side: 'credit', amount: 100000 },
        ],
      })
      await client.journalEntry.create({
        entryDate: '2026-07-18',
        memo: '海外通販(速報)',
        sourceType: 'external_import',
        lines: [
          { accountId, side: 'credit', amount: 2990 },
          { accountId: equityAccount.id, side: 'debit', amount: 2990 },
        ],
        externalTransactionRef: {
          accountId,
          externalId: 'TX-PRELIM-1',
          entryDate: '2026-07-18',
          description: '海外通販(速報)',
          amount: -2990,
          isSettled: false,
        },
      })
      await client.autoSave.flush()
    }, { targetAccountId })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額,残高\n2026/07/20,海外通販(確定),-3000,97000\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    const group = page.getByRole('group', { name: '1件目' })
    await group.getByLabel('これは確定版です').check()

    await expect(page.getByRole('status').filter({ hasText: '一致しています' })).toBeVisible()
  })

  test('CSVに残高列があり帳簿残高と外部残高が一致しない場合、レビュー一覧画面に警告が表示される(取込はブロックしない)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const [targetAccountId] = await setupAccountsAndMapping(
      page,
      [{ category: 'asset', name: '普通預金', isReconcilable: true }],
      {
        accountIndex: 0,
        formatGroupId: 'test-bank',
        label: 'テスト銀行 普通預金',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
        balanceColumn: '残高',
      },
    )

    await page.evaluate(async ({ targetAccountId: accountId }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const equityAccount = await client.account.create({
        category: 'equity',
        name: '普通預金の初期残高',
        isReconcilable: null,
        isSystemManaged: true,
      })
      await client.journalEntry.create({
        entryDate: '2026-07-01',
        sourceType: 'initial_balance',
        lines: [
          { accountId, side: 'debit', amount: 100000 },
          { accountId: equityAccount.id, side: 'credit', amount: 100000 },
        ],
      })
      await client.autoSave.flush()
    }, { targetAccountId })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,90000\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '帳簿残高' })).toBeVisible()
  })

  test('今回アップロードしたCSVバッチの内容を含めて計算し、帳簿残高と外部残高が一致する場合は一致している旨が表示される', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const [targetAccountId] = await setupAccountsAndMapping(
      page,
      [{ category: 'asset', name: '普通預金', isReconcilable: true }],
      {
        accountIndex: 0,
        formatGroupId: 'test-bank',
        label: 'テスト銀行 普通預金',
        dateColumn: '日付',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '摘要',
        amountMode: 'single_signed',
        amountColumn: '金額',
        balanceColumn: '残高',
      },
    )

    await page.evaluate(async ({ targetAccountId: accountId }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const equityAccount = await client.account.create({
        category: 'equity',
        name: '普通預金の初期残高',
        isReconcilable: null,
        isSystemManaged: true,
      })
      await client.journalEntry.create({
        entryDate: '2026-07-01',
        sourceType: 'initial_balance',
        lines: [
          { accountId, side: 'debit', amount: 100000 },
          { accountId: equityAccount.id, side: 'credit', amount: 100000 },
        ],
      })
      await client.autoSave.flush()
    }, { targetAccountId })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '一致しています' })).toBeVisible()
  })
})
