/**
 * CSV取込〜レビュー一覧の基盤(計画Issue #76、docs/domain/statement-import.md 1.5・1.6、
 * docs/domain/reconciliation.md 1.5)と、CSV先選択フロー(計画Issue #78)のE2Eテスト。
 * 実ブラウザ(Chromium)でトップ画面からCSV取込アップロード画面・レビュー一覧画面を操作し、
 * Web Worker + RPC層を経由して、対象科目を選んだ後マッピング定義ではなくCSVファイルを
 * 先に選択できること、アップロード時に対象科目の候補定義への実パース試行で絞り込まれ
 * 成功が1件なら自動的にレビュー一覧へ遷移すること、一致するフォーマットが無い場合の
 * エラー表示、外部取引IDの完全一致重複警告、確定版候補の提示・選択、残高照合警告の
 * 表示を検証する。account-registration.spec.ts・journal-entry.spec.tsと同様、
 * 事前データ準備はpage.evaluate内で新規に作成したWorkerで行い、autoSave.flush()で
 * 即座に永続化してからreloadし、アプリ側のWorkerにIndexedDB経由で反映させる。
 * account・マッピング定義・既存仕訳(重複防止フロー・残高照合の前提データ)は
 * すべて単一のWorker(page.evaluate呼び出し1回)内でまとめて作成し、reloadも1回だけ
 * 行う(journal-entry.spec.tsのsetupAccountsAndReloadと同じ「複数レコードを単一Worker
 * 内でまとめて作成する」パターン)。事前データ作成のためだけに複数のWorkerを順に
 * 作ってその都度reloadすると、後発のWorkerが先発のWorkerのflush()完了前にIndexedDBを
 * 読み込みうるタイミング競合(CI環境の低スペックランナーで顕在化しやすい)によって
 * FOREIGN KEY constraint failedを起こすことが実際に観測されたため、この構成に統一した。
 * seedDefaultAccounts(計画Issue #96)によりWorker起動時点でrevenue/expense区分の標準科目
 * が既に存在するため、各テストが作成する費用科目名はデフォルトシードのリスト
 * (defaultAccountSeedData.ts)と衝突しない名前(テスト費目・エンタメ費)を使う。
 */
import { test, expect, type Page } from '@playwright/test'

interface AccountInput {
  category: string
  name: string
  isReconcilable: boolean | null
  isSystemManaged?: boolean
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

interface JournalEntryLineInput {
  /** accountsのうち、この明細行が使う科目のインデックス */
  accountIndex: number
  side: string
  amount: number
}

interface ExternalTransactionRefInput {
  /** accountsのうち、この突合レコードが紐づく対象科目のインデックス */
  accountIndex: number
  externalId: string
  entryDate: string
  description: string
  amount: number
  isSettled?: boolean
}

interface JournalEntryInput {
  entryDate: string
  memo?: string
  sourceType: string
  lines: JournalEntryLineInput[]
  externalTransactionRef?: ExternalTransactionRefInput
}

interface CounterpartyInput {
  name: string
  /** accountsのうち、default_account_idに設定する科目のインデックス。省略時はnull */
  defaultAccountIndex?: number
  /** 事前登録するcounterparty_patterns(docs/domain/counterparties.md 1.3)。省略時は登録しない */
  patterns?: string[]
}

/**
 * 対象科目・相手科目候補・マッピング定義・既存仕訳(重複防止フロー/残高照合の前提データ)・
 * 取引先(取引先推定サジェストの前提データ、計画Issue #77)をまとめて1つのWorkerで作成し、
 * flush()で即座にIndexedDBへ永続化してから1回だけreloadする。作成した科目のidを返す
 * (テスト側でCSV内容の組み立て等に使う)。mappingは単一のMappingDefinitionInputに加え、
 * 同一科目に複数のマッピング定義を紐づけたい場合(パース成功候補が複数になるケースの検証、
 * 計画Issue #78)のため配列でも渡せる。
 */
async function setupAccountsAndMapping(
  page: Page,
  accounts: AccountInput[],
  mapping: MappingDefinitionInput | MappingDefinitionInput[],
  journalEntries: JournalEntryInput[] = [],
  counterparties: CounterpartyInput[] = [],
): Promise<number[]> {
  const mappings = Array.isArray(mapping) ? mapping : [mapping]
  const accountIds = await page.evaluate(
    async ({ accountInputs, mappings, journalEntries, counterparties }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const ids: number[] = []
      for (const input of accountInputs) {
        const created = await client.account.create(input)
        ids.push(created.id)
      }
      for (const mapping of mappings) {
        const { accountIndex, ...mappingFields } = mapping
        await client.importMappingDefinition.create({ ...mappingFields, accountId: ids[accountIndex] })
      }
      const [defaultMember] = await client.householdMember.findAll()
      for (const entry of journalEntries) {
        const { lines, externalTransactionRef, ...entryFields } = entry
        await client.journalEntry.create({
          ...entryFields,
          householdMemberId: defaultMember.id,
          lines: lines.map((line) => ({
            accountId: ids[line.accountIndex],
            side: line.side,
            amount: line.amount,
          })),
          externalTransactionRef: externalTransactionRef
            ? {
                accountId: ids[externalTransactionRef.accountIndex],
                externalId: externalTransactionRef.externalId,
                entryDate: externalTransactionRef.entryDate,
                description: externalTransactionRef.description,
                amount: externalTransactionRef.amount,
                isSettled: externalTransactionRef.isSettled,
              }
            : undefined,
        })
      }
      for (const counterpartyInput of counterparties) {
        const created = await client.counterparty.create({
          name: counterpartyInput.name,
          defaultAccountId:
            counterpartyInput.defaultAccountIndex === undefined
              ? undefined
              : ids[counterpartyInput.defaultAccountIndex],
        })
        for (const pattern of counterpartyInput.patterns ?? []) {
          await client.counterparty.addPattern(created.id, pattern)
        }
      }
      await client.autoSave.flush()
      return ids
    },
    { accountInputs: accounts, mappings, journalEntries, counterparties },
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  return accountIds
}

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8')
}

/**
 * CSV取込アップロード画面(計画Issue #78)で対象科目を選ぶところまでを行う。マッピング定義は
 * CSVファイルのアップロード時に候補への実パース試行で絞り込まれるため、ここでは選択しない
 * (組み込みマッピング定義がシードされるようになっているが、実際の列名がテストCSVと
 * 一致しないため候補には残らず、テストで作成した専用定義のみがパースに成功する)。
 */
async function startUpload(page: Page, accountName: string) {
  await page.getByRole('button', { name: '明細を取り込む' }).click()
  await page.getByLabel('対象科目').selectOption({ label: accountName })
}

test.describe('CSV取込〜レビュー一覧', () => {
  test('対象科目を選ぶとマッピング定義ではなくCSVファイルを先に選択でき、アップロードするとレビュー一覧へ遷移し相手科目を手動選択できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'expense', name: 'テスト費目', isReconcilable: null },
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

    // マッピング定義を選ぶ画面は経由せず、CSVファイルの選択欄がすぐに表示される(計画Issue #78)
    await expect(page.getByLabel('CSVファイル')).toBeVisible()
    await expect(page.getByLabel('マッピング定義')).not.toBeVisible()

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
    await group.getByLabel('相手科目').selectOption({ label: 'テスト費目' })
    await expect(group.getByLabel('相手科目')).toHaveValue(/.+/)
  })

  test('アップロードしたCSVの列構成がどの候補定義とも一致しない場合、エラーメッセージが表示され取込が進まない', async ({
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

    await expect(page.getByRole('alert')).toContainText('一致するマッピング定義が見つかりませんでした')
    await expect(page.getByRole('heading', { name: '明細のレビュー' })).not.toBeVisible()
  })

  test('パースに成功する候補定義が複数ある場合、ユーザーが選択でき、選んだ定義でレビュー一覧へ進む', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndMapping(
      page,
      [{ category: 'asset', name: '普通預金', isReconcilable: true }],
      [
        {
          accountIndex: 0,
          formatGroupId: 'bank-a',
          label: '銀行A形式',
          dateColumn: '日付',
          dateFormat: 'YYYY/MM/DD',
          descriptionColumn: '摘要',
          amountMode: 'single_signed',
          amountColumn: '金額',
        },
        {
          accountIndex: 0,
          formatGroupId: 'bank-b',
          label: '銀行B形式',
          dateColumn: '日付',
          dateFormat: 'YYYY/MM/DD',
          descriptionColumn: '摘要',
          amountMode: 'single_signed',
          amountColumn: '金額',
        },
      ],
    )

    await startUpload(page, '普通預金')
    await page
      .getByLabel('CSVファイル')
      .setInputFiles({
        name: 'statement.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer('日付,摘要,金額\n2026/07/20,スーパー,-3000\n'),
      })
    await page.getByRole('button', { name: '取り込む' }).click()

    const definitionSelect = page.getByLabel('マッピング定義')
    await expect(definitionSelect).toBeVisible()
    await expect(page.getByRole('heading', { name: '明細のレビュー' })).not.toBeVisible()

    await definitionSelect.selectOption({ label: '銀行B形式' })
    await page.getByRole('button', { name: '取り込む' }).click()

    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()
    const group = page.getByRole('group', { name: '1件目' })
    await expect(group.getByText('スーパー')).toBeVisible()
  })

  test('外部取引IDが完全一致する明細は取込済みの可能性がある警告が表示され、既定では取込対象外のままである', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'expense', name: 'テスト費目', isReconcilable: null },
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
      [
        {
          entryDate: '2026-07-20',
          memo: 'スーパー',
          sourceType: 'external_import',
          lines: [
            { accountIndex: 0, side: 'credit', amount: 3000 },
            { accountIndex: 1, side: 'debit', amount: 3000 },
          ],
          externalTransactionRef: {
            accountIndex: 0,
            externalId: 'TX-001',
            entryDate: '2026-07-20',
            description: 'スーパー',
            amount: -3000,
          },
        },
      ],
    )

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

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '楽天カード引落口座', isReconcilable: true },
        { category: 'expense', name: 'エンタメ費', isReconcilable: null },
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
      [
        {
          entryDate: '2026-07-18',
          memo: '海外通販(速報)',
          sourceType: 'external_import',
          lines: [
            { accountIndex: 0, side: 'credit', amount: 2990 },
            { accountIndex: 1, side: 'debit', amount: 2990 },
          ],
          externalTransactionRef: {
            accountIndex: 0,
            externalId: 'TX-PRELIM-1',
            entryDate: '2026-07-18',
            description: '海外通販(速報)',
            amount: -2990,
            isSettled: false,
          },
        },
      ],
    )

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

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'equity', name: '普通預金の初期残高', isReconcilable: null, isSystemManaged: true },
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
      [
        {
          entryDate: '2026-07-01',
          sourceType: 'initial_balance',
          lines: [
            { accountIndex: 0, side: 'debit', amount: 100000 },
            { accountIndex: 1, side: 'credit', amount: 100000 },
          ],
        },
        {
          entryDate: '2026-07-18',
          memo: '海外通販(速報)',
          sourceType: 'external_import',
          lines: [
            { accountIndex: 0, side: 'credit', amount: 2990 },
            { accountIndex: 1, side: 'debit', amount: 2990 },
          ],
          externalTransactionRef: {
            accountIndex: 0,
            externalId: 'TX-PRELIM-1',
            entryDate: '2026-07-18',
            description: '海外通販(速報)',
            amount: -2990,
            isSettled: false,
          },
        },
      ],
    )

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

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'equity', name: '普通預金の初期残高', isReconcilable: null, isSystemManaged: true },
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
      [
        {
          entryDate: '2026-07-01',
          sourceType: 'initial_balance',
          lines: [
            { accountIndex: 0, side: 'debit', amount: 100000 },
            { accountIndex: 1, side: 'credit', amount: 100000 },
          ],
        },
      ],
    )

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

    await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'equity', name: '普通預金の初期残高', isReconcilable: null, isSystemManaged: true },
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
      [
        {
          entryDate: '2026-07-01',
          sourceType: 'initial_balance',
          lines: [
            { accountIndex: 0, side: 'debit', amount: 100000 },
            { accountIndex: 1, side: 'credit', amount: 100000 },
          ],
        },
      ],
    )

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

  test('CSVアップロードから取引先推定・一括割当て・重複警告を経てレビュー確定するまでの一連のフローが完結する(計画Issue #77)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    const accountIds = await setupAccountsAndMapping(
      page,
      [
        { category: 'asset', name: '普通預金', isReconcilable: true },
        { category: 'expense', name: 'テスト費目', isReconcilable: null },
        { category: 'expense', name: 'エンタメ費', isReconcilable: null },
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
      [
        {
          entryDate: '2026-07-15',
          memo: 'ATM引出',
          sourceType: 'external_import',
          lines: [
            { accountIndex: 0, side: 'credit', amount: 5000 },
            { accountIndex: 1, side: 'debit', amount: 5000 },
          ],
          externalTransactionRef: {
            accountIndex: 0,
            externalId: 'TX-DUP',
            entryDate: '2026-07-15',
            description: 'ATM引出',
            amount: -5000,
          },
        },
      ],
      [
        { name: 'イオン', defaultAccountIndex: 1, patterns: ['イオン'] },
        { name: '謎商店', defaultAccountIndex: 2 },
      ],
    )

    await startUpload(page, '普通預金')
    await page.getByLabel('CSVファイル').setInputFiles({
      name: 'statement.csv',
      mimeType: 'text/csv',
      buffer: csvBuffer(
        '日付,摘要,金額,取引ID\n' +
          '2026/07/15,ATM引出,-5000,TX-DUP\n' +
          '2026/07/20,イオン渋谷店,-3000,TX-NEW1\n' +
          '2026/07/21,謎の店舗,-1000,TX-NEW2\n' +
          '2026/07/22,謎の店舗,-1500,TX-NEW3\n',
      ),
    })
    await page.getByRole('button', { name: '取り込む' }).click()
    await expect(page.getByRole('heading', { name: '明細のレビュー' })).toBeVisible()

    // 1件目: 完全一致重複(#76) → 既定では取込対象外のまま
    const group1 = page.getByRole('group', { name: '1件目' })
    await expect(group1.getByText('取込済みの可能性がある明細です。')).toBeVisible()
    await expect(group1.getByLabel('それでも取り込む')).not.toBeChecked()

    // 2件目: 取引先パターンに一致 → 取引先・相手科目が自動サジェストされる
    const group2 = page.getByRole('group', { name: '2件目' })
    await expect(group2.getByLabel('取引先')).toHaveValue(/.+/)
    await expect(group2.getByLabel('相手科目')).toHaveValue(String(accountIds[1]))

    // 3・4件目: 取引先未特定の同一摘要 → 一括割当てバナーが表示される
    await expect(
      page.getByText('同じ摘要の明細が2件あります。まとめて取引先/相手科目を割り当てますか?'),
    ).toBeVisible()
    await page.getByLabel('一括割当ての取引先').selectOption({ label: '謎商店' })
    await page.getByRole('button', { name: 'まとめて割り当てる' }).click()

    const group3 = page.getByRole('group', { name: '3件目' })
    const group4 = page.getByRole('group', { name: '4件目' })
    await expect(group3.getByLabel('相手科目')).toHaveValue(String(accountIds[2]))
    await expect(group4.getByLabel('相手科目')).toHaveValue(String(accountIds[2]))

    // レビュー確定: 重複除外された1件目を除く3件が確定される(継続処理方式、計画Issue #77設計方針2)
    await page.getByRole('button', { name: '確定する' }).click()
    await expect(page.getByText('3件を確定しました(0件失敗)')).toBeVisible()

    // 確定後、仕訳が実際に永続化され登録済み科目一覧の残高に反映されていることを確認する
    // (計画Issue #95により、一覧画面へは科目管理ハブ画面「科目を管理する」を経由する)
    await page.getByRole('button', { name: '戻る' }).click()
    await page.getByRole('button', { name: '戻る' }).click()
    await page.getByRole('button', { name: '科目を管理する' }).click()
    await page.getByRole('button', { name: '科目一覧を見る' }).click()
    await expect(page.getByRole('heading', { name: '登録済みの科目' })).toBeVisible()
    await expect(
      page.getByRole('listitem').filter({ hasText: '普通預金' }).filter({ hasText: '-￥10,500' }),
    ).toBeVisible()
  })
})
