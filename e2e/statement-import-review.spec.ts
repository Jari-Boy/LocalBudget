/**
 * 明細取込画面(計画Issue #76・#77・#78の基盤を計画Issue #151で1画面に統合)のE2Eテスト。
 * 実ブラウザ(Chromium)で、サイドナビの「明細取込」から取込先とCSVを選び、Web Worker + RPC層を
 * 経由して、候補定義への実パース試行による絞り込み、一致する定義が無い場合のエラー表示、
 * 完全一致重複の行(対象外)、確定版の候補の置き換えと残高照合、取引先推定・一括設定・確定の
 * 一連のフロー、マスタの「明細マッピング」タブでの編集を検証する。細かい入力規則は
 * コンポーネントテスト(StatementImportScreen.test.tsx)で確認している。
 * account-registration.spec.ts・journal-entry.spec.tsと同様、事前データ準備はpage.evaluate内で
 * 新規に作成したWorkerで行い、autoSave.flush()で即座に永続化してからreloadする。科目・
 * マッピング定義・既存仕訳・取引先は単一のWorker(page.evaluate呼び出し1回)内でまとめて作成し、
 * reloadも1回だけ行う(複数のWorkerを順に作ると、後発のWorkerが先発のflush()完了前にIndexedDBを
 * 読み込みうるタイミング競合でFOREIGN KEY constraint failedを起こすことが観測されたため)。
 * seedDefaultAccountsにより標準科目が既にあるため、費用科目名は標準と衝突しない名前
 * (テスト費目・エンタメ費)を使う。
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

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

interface JournalEntryInput {
  entryDate: string
  memo?: string
  sourceType: string
  lines: Array<{ accountIndex: number; side: string; amount: number }>
  externalTransactionRef?: {
    accountIndex: number
    externalId: string
    entryDate: string
    description: string
    amount: number
    isSettled?: boolean
  }
}

interface CounterpartyInput {
  name: string
  /** accountsのうち、default_account_idに設定する科目のインデックス。省略時はnull */
  defaultAccountIndex?: number
  patterns?: string[]
}

/**
 * 科目・マッピング定義・既存仕訳・取引先をまとめて1つのWorkerで作成し、flush()で永続化してから
 * 1回だけreloadする。作成した科目のidを返す。
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
        await client.importMappingDefinition.create({ ...mappingFields, accountIds: [ids[accountIndex]] })
      }
      const [defaultMember] = await client.householdMember.findAll()
      for (const entry of journalEntries) {
        const { lines, externalTransactionRef, ...entryFields } = entry
        await client.journalEntry.create({
          ...entryFields,
          householdMemberId: defaultMember.id,
          lines: lines.map((line) => ({
            householdMemberId: defaultMember.id,
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
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  return accountIds
}

const BANK_MAPPING: MappingDefinitionInput = {
  accountIndex: 0,
  formatGroupId: 'test-bank',
  label: 'テスト銀行 普通預金',
  dateColumn: '日付',
  dateFormat: 'YYYY/MM/DD',
  descriptionColumn: '摘要',
  amountMode: 'single_signed',
  amountColumn: '金額',
  balanceColumn: '残高',
}

const BANK_AND_EXPENSE: AccountInput[] = [
  { category: 'asset', name: '普通預金', isReconcilable: true },
  { category: 'expense', name: 'テスト費目', isReconcilable: null },
]

function csvFile(content: string) {
  return { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(content, 'utf-8') }
}

/**
 * サイドナビの「明細取込」を開き、CSVを選ぶ。取込先は、マッピング定義に紐づく科目が初期値になる
 * (accountNameはその初期値の確認に使う)。紐づく科目が無い定義では取込先が未選択のまま。
 */
async function startImport(page: Page, accountName: string | null, csv: string) {
  await page.getByRole('link', { name: '明細取込', exact: true }).click()
  await page.getByLabel('CSVを選択').setInputFiles(csvFile(csv))
  if (accountName !== null) {
    await expect(page.getByLabel(/^取込先/).locator('option:checked')).toHaveText(accountName)
  }
}

/** 行の中の選択ツリーを開き、検索して項目を選ぶ */
async function pickTree(page: Page, scope: Locator, label: string, item: string) {
  await scope.getByRole('button', { name: new RegExp(`^${label}`) }).click()
  const dialog = page.getByRole('dialog', { name: label })
  await dialog.getByRole('searchbox').fill(item)
  await dialog.getByRole('button', { name: item, exact: true }).click()
}

const rowOf = (page: Page, text: string | RegExp) => page.getByRole('row', { name: text }).first()

test.describe('明細取込画面', () => {
  test('取込先とCSVを選ぶと同じ画面に1件1行で並び、相手科目を選んで確定すると仕訳が作られる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING)

    await startImport(page, '普通預金', '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n')

    await expect(page.getByText(/statement\.csv を読み込み済み。新規 1 件/)).toBeVisible()
    const row = rowOf(page, /スーパー/)
    await expect(row).toContainText('2026/07/20')
    await expect(row).toContainText('-¥3,000')
    await pickTree(page, row, '相手科目', 'テスト費目')
    await page.getByRole('button', { name: '1 件を「普通預金」に確定' }).click()

    await expect(page.getByText('確定しました。続けて次のCSVを取り込めます。')).toBeVisible()
    await expect(page.getByRole('row', { name: /スーパー/ })).toHaveCount(0)
  })

  test('相手科目の選択ツリーは、表の枠で見切れず、画面の中に全体が表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING)

    await startImport(page, '普通預金', '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n')
    await rowOf(page, /スーパー/).getByRole('button', { name: /^相手科目/ }).click()

    // 一覧が1行だけでも、ポップアップは表の枠(overflow)の外に出て、全体が画面内に収まる
    await expect(page.getByRole('dialog', { name: '相手科目' })).toBeInViewport({ ratio: 1 })
  })

  test('列構成がどの候補定義とも一致しないCSVでは、エラーメッセージが表示され一覧は出ない', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING)

    await startImport(page, null, '違う列1,違う列2\na,b\n')

    await expect(page.getByRole('alert')).toContainText('に一致するマッピングが見つかりませんでした')
    await expect(page.getByRole('table', { name: '明細の一覧' })).toHaveCount(0)
  })

  test('パースに成功する候補定義が複数あるときは、表示名の選択欄が出て、選ぶと取込先の確認に進む', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, [
      BANK_MAPPING,
      { ...BANK_MAPPING, formatGroupId: 'test-bank-2', label: 'テスト銀行 別形式' },
    ])

    await startImport(page, null, '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n')

    await page.getByLabel('マッピング定義').selectOption({ label: 'テスト銀行 別形式' })
    await expect(page.getByLabel(/^取込先/).locator('option:checked')).toHaveText('普通預金')
    await expect(page.getByRole('table', { name: '明細の一覧' })).toBeVisible()
    await expect(rowOf(page, /スーパー/)).toBeVisible()
  })

  test('一致する定義が無いCSVは、画面内のダイアログでマッピングを作り、取込先を選んで続けて取り込める', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, { ...BANK_MAPPING, dateColumn: '存在しない列' })

    await startImport(page, null, '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n')
    await page.getByRole('button', { name: 'このCSVでマッピングを新規作成' }).click()

    const dialog = page.getByRole('dialog', { name: 'マッピングを新規作成' })
    await expect(dialog.getByText('列を推測しました。内容を確認してください')).toBeVisible()
    await dialog.getByLabel('表示名').fill('新しい銀行')
    await dialog.getByLabel('金融機関名').selectOption('__new__')
    await dialog.getByLabel('新しい金融機関名').fill('new-bank')
    await expect(dialog.getByRole('table', { name: '元のCSV' })).toBeVisible()
    await dialog.getByRole('button', { name: '保存して取り込む' }).click()

    // 作った定義はどの科目にも紐づいていないので、取込先を選ぶと一覧が出る
    await page.getByLabel(/^取込先/).selectOption({ label: '普通預金' })
    await expect(page.getByText(/statement\.csv を読み込み済み/)).toBeVisible()
    await expect(rowOf(page, /スーパー/)).toBeVisible()
  })

  test('確定版の可能性がある行で「これは確定版です」を選ぶと、旧仕訳を残高照合から除外して二重計上しない', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING, [
      {
        entryDate: '2026-07-20',
        memo: '速報',
        sourceType: 'external_import',
        lines: [
          { accountIndex: 0, side: 'credit', amount: 3000 },
          { accountIndex: 1, side: 'debit', amount: 3000 },
        ],
        externalTransactionRef: {
          accountIndex: 0,
          externalId: 'TX-PROVISIONAL',
          entryDate: '2026-07-20',
          description: 'スーパー(速報)',
          amount: -3000,
          isSettled: false,
        },
      },
    ])

    await startImport(page, '普通預金', '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,-3000\n')

    await expect(page.getByText(/確定版の可能性があります/)).toBeVisible()
    await page.getByLabel('これは確定版です').check()
    await expect(page.getByRole('status').filter({ hasText: '一致しています' })).toBeVisible()
  })

  test('CSVの残高と帳簿残高が一致しないときは、警告が表示される(取込はブロックしない)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING)

    await startImport(page, '普通預金', '日付,摘要,金額,残高\n2026/07/20,スーパー,-3000,97000\n')

    await expect(page.getByRole('alert').filter({ hasText: '一致しません' })).toBeVisible()
    await expect(rowOf(page, /スーパー/)).toBeVisible()
  })

  test('取引先の推定・重複の行・一括設定を経て確定するまでの一連のフローが完結する', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    const accountIds = await setupAccountsAndMapping(
      page,
      [...BANK_AND_EXPENSE, { category: 'expense', name: 'エンタメ費', isReconcilable: null }],
      { ...BANK_MAPPING, balanceColumn: undefined, externalIdColumn: '取引ID' },
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
      [{ name: 'イオン', defaultAccountIndex: 1, patterns: ['イオン'] }],
    )

    await startImport(
      page,
      '普通預金',
      '日付,摘要,金額,取引ID\n' +
        '2026/07/15,ATM引出,-5000,TX-DUP\n' +
        '2026/07/20,イオン渋谷店,-3000,TX-NEW1\n' +
        '2026/07/21,謎の店舗,-1000,TX-NEW2\n' +
        '2026/07/22,謎の店舗,-1500,TX-NEW3\n',
    )

    // 1行目: 取り込み済みの行は入力欄も選択も出ず、対象外と表示される
    await expect(rowOf(page, /ATM引出/)).toContainText('取り込み済みのため対象外です')
    await expect(rowOf(page, /ATM引出/).getByRole('checkbox')).toHaveCount(0)
    // 2行目: 取引先パターンに一致し、取引先の既定の科目が入る
    await expect(rowOf(page, /イオン渋谷店/).getByRole('button', { name: /^相手科目: テスト費目/ })).toBeVisible()
    await expect(rowOf(page, /イオン渋谷店/).getByRole('button', { name: /^取引先: イオン/ })).toBeVisible()

    // 3・4行目を選んで、相手科目を一括設定する
    await page.getByLabel('謎の店舗を選択').first().check()
    await page.getByLabel('謎の店舗を選択').nth(1).check()
    const bulk = page.getByRole('group', { name: '選択した明細への一括設定' })
    await expect(bulk).toContainText('2件に一括設定')
    await pickTree(page, bulk, '一括の相手科目', 'エンタメ費')
    await expect(bulk).toContainText('2件に設定しました')

    await page.getByRole('button', { name: '3 件を「普通預金」に確定' }).click()
    await expect(page.getByText('確定しました。', { exact: false })).toBeVisible()

    // 仕訳が永続化され、普通預金の残高に反映されている。withAutoSaveのtrailing debounce(2秒)を
    // 挟むため、別Workerから見えるまでpollで待つ
    await expect
      .poll(
        () =>
          page.evaluate(async (accountId) => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const { calculateAccountBalance } = await import(
              '/src/domain/financial-statement/calculateAccountBalance.ts'
            )
            const client = await createDbClient()
            const entries = await client.journalEntry.findAll()
            const lines = entries.flatMap((entry) => entry.lines).filter((line) => line.accountId === accountId)
            return calculateAccountBalance('asset', lines)
          }, accountIds[0]),
        { timeout: 10000 },
      )
      .toBe(-10500)
  })

  test('マスタの「明細マッピング」タブで定義の表示名を編集して保存できる(「マッピングを編集」からも移動できる)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupAccountsAndMapping(page, BANK_AND_EXPENSE, BANK_MAPPING)

    await page.getByRole('link', { name: '明細取込', exact: true }).click()
    await page.getByRole('button', { name: 'マッピングを編集' }).click()

    await expect(page).toHaveURL(/\/master\/mappings$/)
    await page.getByRole('button', { name: /テスト銀行 普通預金/ }).click()
    const panel = page.getByRole('region', { name: 'マッピングの編集' })
    await panel.getByLabel('表示名').fill('テスト銀行(改)')
    await panel.getByRole('button', { name: '保存' }).click()

    await expect(panel.getByText('保存しました')).toBeVisible()
    await expect(page.getByRole('button', { name: /テスト銀行\(改\)/ })).toBeVisible()
  })
})
