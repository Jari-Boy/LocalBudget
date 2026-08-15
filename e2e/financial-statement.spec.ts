/**
 * 財務諸表(PL/BS)表示画面(計画Issue #34)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、PL(月次プリセット)・BS(基準日の年月プリセット/日付詳細指定)の
 * 単一画面タブ切替表示、プロジェクトの複数選択絞り込みとタブ切替をまたいだ選択状態の
 * 保持、前期比較(当期・比較期間・差分の表示)、BSの複式簿記恒等式(資産=負債+純資産)が
 * 画面表示上も成立すること、PDF/CSVエクスポートに関するUIが存在しないこと
 * (docs/domain/financial-statements.md 1.1節、計画Issue #34でスコープ外と判断)を、
 * 実際のWeb Worker + RPC層を経由して検証する。個々の集計ロジックの詳細・空状態表示等は
 * コンポーネントテスト(FinancialStatementScreen.test.tsx)側で検証済みのため、ここでは
 * 実ブラウザでの重要フローに絞る。project-management.spec.tsと同様、DB書き込みの
 * 永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、Repository経由でのDB直接操作後は
 * pollで反映を待ってからreloadする。期間は実行時の「今月」を基準に動的に算出し、
 * 月初日(10日)を使うことで実行日に関わらず当月・前月の範囲内に収まるようにする。
 */
import { test, expect, type Page } from '@playwright/test'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function currentMonthDate(day: number): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`
}

function previousMonthDate(day: number): string {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, day)
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`
}

async function waitForJournalEntryMemo(page: Page, memo: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetMemo) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const entries = await client.journalEntry.findAll()
          return entries.some((entry) => entry.memo === targetMemo)
        }, memo),
      { timeout: 10000 },
    )
    .toBe(true)
}

async function openFinancialStatementScreen(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  await page.getByRole('button', { name: '財務諸表を見る' }).click()
  await expect(page.getByRole('heading', { name: '財務諸表' })).toBeVisible()
}

test.describe('財務諸表(PL/BS)表示画面', () => {
  test('PLが月次プリセットで表示され、プロジェクトの複数選択絞り込みがタブ切替後も保持される', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(
      async ({ entryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const food = await client.account.create({ category: 'expense', name: 'E2E食費', isReconcilable: null })
        const cash = await client.account.create({ category: 'asset', name: 'E2E現金', isReconcilable: false })
        const projectA = await client.project.create({ name: 'E2EプロジェクトA' })
        const projectB = await client.project.create({ name: 'E2EプロジェクトB' })
        const [member] = await client.householdMember.findAll()
        await client.journalEntry.create({
          entryDate,
          memo: 'FS-E2E-project-a',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 3000, projectId: projectA.id },
            { accountId: cash.id, side: 'credit', amount: 3000, projectId: projectA.id },
          ],
        })
        await client.journalEntry.create({
          entryDate,
          memo: 'FS-E2E-project-b',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 7000, projectId: projectB.id },
            { accountId: cash.id, side: 'credit', amount: 7000, projectId: projectB.id },
          ],
        })
      },
      { entryDate: currentMonthDate(10) },
    )
    await waitForJournalEntryMemo(page, 'FS-E2E-project-b')
    await page.reload()

    await openFinancialStatementScreen(page)
    await expect(page.getByRole('button', { name: '損益計算書(PL)' })).toHaveAttribute('aria-pressed', 'true')

    const foodRow = page.getByRole('row').filter({ hasText: 'E2E食費' })
    await expect(foodRow.getByText('￥10,000')).toBeVisible()

    await page.getByLabel('プロジェクトで絞り込み(複数選択可)').selectOption({ label: 'E2EプロジェクトA' })
    await expect(foodRow.getByText('￥3,000')).toBeVisible()

    // プロジェクトBも同時選択(2件の複数選択)すると、両方の明細が合算されて表示される
    await page.getByLabel('プロジェクトで絞り込み(複数選択可)').selectOption([
      { label: 'E2EプロジェクトA' },
      { label: 'E2EプロジェクトB' },
    ])
    await expect(foodRow.getByText('￥10,000')).toBeVisible()

    // Aのみに戻してからタブ切替の保持を確認する
    await page.getByLabel('プロジェクトで絞り込み(複数選択可)').selectOption({ label: 'E2EプロジェクトA' })
    await expect(foodRow.getByText('￥3,000')).toBeVisible()

    await page.getByRole('button', { name: '貸借対照表(BS)' }).click()
    await page.getByRole('button', { name: '損益計算書(PL)' }).click()

    await expect(page.getByLabel('プロジェクトで絞り込み(複数選択可)')).toHaveValues([
      await page.evaluate(async () => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const projects = await client.project.findAll()
        return String(projects.find((p) => p.name === 'E2EプロジェクトA')!.id)
      }),
    ])
    await expect(foodRow.getByText('￥3,000')).toBeVisible()
  })

  test('BSの基準日を年月プリセット・日付詳細指定のいずれでも指定でき、絞り込みなしの全体表示で恒等式(資産=負債+純資産)が成立する', async ({
    page,
  }) => {
    await page.goto('/')
    await page.evaluate(
      async ({ entryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const cash = await client.account.create({ category: 'asset', name: 'E2E現金', isReconcilable: false })
        const equity = await client.account.create({
          category: 'equity',
          name: 'E2E元入金',
          isReconcilable: null,
          isSystemManaged: true,
        })
        const [member] = await client.householdMember.findAll()
        await client.journalEntry.create({
          entryDate,
          memo: 'FS-E2E-initial-balance',
          sourceType: 'initial_balance',
          householdMemberId: member.id,
          lines: [
            { accountId: cash.id, side: 'debit', amount: 100000 },
            { accountId: equity.id, side: 'credit', amount: 100000 },
          ],
        })
      },
      { entryDate: currentMonthDate(1) },
    )
    await waitForJournalEntryMemo(page, 'FS-E2E-initial-balance')
    await page.reload()

    await openFinancialStatementScreen(page)
    await page.getByRole('button', { name: '貸借対照表(BS)' }).click()

    // 自分が投入したE2E現金・E2E元入金がそれぞれ¥100,000として表示されることを確認する
    // (このDBには他のE2Eテスト/開発用ダミーデータ由来の科目も存在しうるため、
    // 合計金額を固定値で断定せず、自分が作成した科目に絞って確認する)
    await expect(page.getByRole('row').filter({ hasText: 'E2E現金' }).getByText('￥100,000')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'E2E元入金' }).getByText('￥100,000')).toBeVisible()

    async function assertIdentityHolds() {
      const assetsText = await page
        .getByText('資産合計:', { exact: true })
        .locator('xpath=..')
        .textContent()
      const identityText = await page.getByText('資産 = 負債 + 純資産:').locator('xpath=..').textContent()
      expect(assetsText!.replace('資産合計:', '')).toBe(identityText!.replace('資産 = 負債 + 純資産:', ''))
    }
    await assertIdentityHolds()

    // 日付での詳細指定に切り替えても(当月末日を明示指定)、恒等式が成立し続けることを確認する
    await page.getByLabel('日付で指定').check()
    const lastDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    const lastDayInput = `${lastDayOfMonth.getFullYear()}-${pad(lastDayOfMonth.getMonth() + 1)}-${pad(lastDayOfMonth.getDate())}`
    await page.getByLabel('基準日').fill(lastDayInput)
    await expect(page.getByRole('row').filter({ hasText: 'E2E現金' }).getByText('￥100,000')).toBeVisible()
    await assertIdentityHolds()
  })

  test('BSの比較基準は年月選択・日付指定のいずれのモードでもユーザーが直接選べる', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(
      async ({ previousMonthEntryDate, currentMonthEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const cash = await client.account.create({ category: 'asset', name: 'E2E現金3', isReconcilable: false })
        const equity = await client.account.create({
          category: 'equity',
          name: 'E2E元入金3',
          isReconcilable: null,
          isSystemManaged: true,
        })
        const [member] = await client.householdMember.findAll()
        await client.journalEntry.create({
          entryDate: previousMonthEntryDate,
          memo: 'FS-E2E-bs-comparison-previous',
          sourceType: 'initial_balance',
          householdMemberId: member.id,
          lines: [
            { accountId: cash.id, side: 'debit', amount: 60000 },
            { accountId: equity.id, side: 'credit', amount: 60000 },
          ],
        })
        await client.journalEntry.create({
          entryDate: currentMonthEntryDate,
          memo: 'FS-E2E-bs-comparison-current',
          householdMemberId: member.id,
          lines: [
            { accountId: cash.id, side: 'debit', amount: 40000 },
            { accountId: equity.id, side: 'credit', amount: 40000 },
          ],
        })
      },
      { previousMonthEntryDate: previousMonthDate(1), currentMonthEntryDate: currentMonthDate(10) },
    )
    await waitForJournalEntryMemo(page, 'FS-E2E-bs-comparison-current')
    await page.reload()

    await openFinancialStatementScreen(page)
    await page.getByRole('button', { name: '貸借対照表(BS)' }).click()
    const cashRow = page.getByRole('row').filter({ hasText: 'E2E現金3' })
    await expect(cashRow.getByText('￥100,000')).toBeVisible()

    // 年月選択モード: 「比較する」を有効にし、比較基準年月として前月を選ぶと、
    // 前月末時点の残高(￥60,000)・当期との差分(￥40,000)が同じ行に表示される
    await page.getByLabel('比較する').check()
    const now = new Date()
    const previousMonthDateObj = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    await page
      .getByLabel('比較基準年月(月末時点)', { exact: true })
      .selectOption(String(previousMonthDateObj.getFullYear()))
    await page.getByLabel('比較基準年月(月末時点)月').selectOption(String(previousMonthDateObj.getMonth() + 1))
    await expect(cashRow.getByText('￥60,000')).toBeVisible()
    await expect(cashRow.getByText('￥40,000')).toBeVisible()

    // 日付指定モード: 比較基準日の入力は当期の基準日より前の日付に制約される
    await page.getByLabel('日付で指定').check()
    const currentBasisDate = currentMonthDate(15)
    await page.getByLabel('基準日', { exact: true }).fill(currentBasisDate)
    await page.getByLabel('比較する').check()
    const comparisonDateInput = page.getByLabel('比較基準日')
    await expect(comparisonDateInput).toHaveAttribute('max', currentMonthDate(14))
  })

  test('前期比較を選択すると当期・比較期間・差分が表示され、PDF/CSVエクスポートに関するUIは存在しない', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(
      async ({ currentEntryDate, previousEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const food = await client.account.create({ category: 'expense', name: 'E2E食費', isReconcilable: null })
        const cash = await client.account.create({ category: 'asset', name: 'E2E現金', isReconcilable: false })
        const [member] = await client.householdMember.findAll()
        await client.journalEntry.create({
          entryDate: currentEntryDate,
          memo: 'FS-E2E-comparison-current',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 3000 },
            { accountId: cash.id, side: 'credit', amount: 3000 },
          ],
        })
        await client.journalEntry.create({
          entryDate: previousEntryDate,
          memo: 'FS-E2E-comparison-previous',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 2000 },
            { accountId: cash.id, side: 'credit', amount: 2000 },
          ],
        })
      },
      { currentEntryDate: currentMonthDate(10), previousEntryDate: previousMonthDate(10) },
    )
    await waitForJournalEntryMemo(page, 'FS-E2E-comparison-previous')
    await page.reload()

    await openFinancialStatementScreen(page)
    await page.getByLabel('比較').selectOption({ label: '前期' })

    // 合計行は他のE2Eテスト/開発用ダミーデータ由来の科目も含みうるため、
    // 自分が作成した「E2E食費」の科目別内訳行(当期・比較期間・差分)で確認する
    const foodRow = page.getByRole('row').filter({ hasText: 'E2E食費' })
    await expect(foodRow.getByText('￥3,000')).toBeVisible()
    await expect(foodRow.getByText('￥2,000')).toBeVisible()
    await expect(foodRow.getByText('￥1,000')).toBeVisible()

    await expect(page.getByRole('button', { name: /PDF|CSV|エクスポート/ })).toHaveCount(0)
    await expect(page.getByText(/PDF|CSV/)).toHaveCount(0)
  })

  test('世帯メンバー・取引先の複数選択絞り込みができ、PLの日付詳細指定・年次プリセットが機能する', async ({ page }) => {
    await page.goto('/')
    const otherMemberName = await page.evaluate(
      async ({ currentEntryDate, januaryEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const food = await client.account.create({ category: 'expense', name: 'E2E食費2', isReconcilable: null })
        const cash = await client.account.create({ category: 'asset', name: 'E2E現金2', isReconcilable: false })
        const [member] = await client.householdMember.findAll()
        const otherMember = await client.householdMember.create({ name: 'E2E配偶者' })
        const supermarket = await client.counterparty.create({ name: 'E2Eスーパー' })
        const restaurant = await client.counterparty.create({ name: 'E2Eレストラン' })

        await client.journalEntry.create({
          entryDate: currentEntryDate,
          memo: 'FS-E2E-member-self',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 4000, counterpartyId: supermarket.id },
            { accountId: cash.id, side: 'credit', amount: 4000 },
          ],
        })
        await client.journalEntry.create({
          entryDate: currentEntryDate,
          memo: 'FS-E2E-member-other',
          householdMemberId: otherMember.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 6000, counterpartyId: restaurant.id },
            { accountId: cash.id, side: 'credit', amount: 6000 },
          ],
        })
        // 年次プリセット確認用に1月の明細も投入する(当月プリセットでは含まれないことの対比)
        await client.journalEntry.create({
          entryDate: januaryEntryDate,
          memo: 'FS-E2E-january',
          householdMemberId: member.id,
          lines: [
            { accountId: food.id, side: 'debit', amount: 1500, counterpartyId: supermarket.id },
            { accountId: cash.id, side: 'credit', amount: 1500 },
          ],
        })
        return otherMember.name
      },
      { currentEntryDate: currentMonthDate(10), januaryEntryDate: `${new Date().getFullYear()}-01-15` },
    )
    await waitForJournalEntryMemo(page, 'FS-E2E-january')
    await page.reload()

    await openFinancialStatementScreen(page)
    const foodRow = page.getByRole('row').filter({ hasText: 'E2E食費2' })

    // 絞り込みなしでは当月分(4000+6000=10000)のみが対象(1月分はプリセット範囲外)
    await expect(foodRow.getByText('￥10,000')).toBeVisible()

    // 世帯メンバーで絞り込むと、そのメンバーの明細のみになる
    await page.getByLabel('世帯メンバーで絞り込み(複数選択可)').selectOption({ label: otherMemberName })
    await expect(foodRow.getByText('￥6,000')).toBeVisible()

    // 世帯メンバーの絞り込みを解除し、取引先で絞り込む
    await page.getByLabel('世帯メンバーで絞り込み(複数選択可)').selectOption([])
    await page.getByLabel('取引先で絞り込み(複数選択可)').selectOption({ label: 'E2Eスーパー' })
    await expect(foodRow.getByText('￥4,000')).toBeVisible()
    await page.getByLabel('取引先で絞り込み(複数選択可)').selectOption([])

    // 日付での詳細指定に切り替えて1月を含む範囲を指定すると、1月分も集計に含まれる
    await page.getByLabel('日付で指定').check()
    const currentYear = new Date().getFullYear()
    await page.getByLabel('期初').fill(`${currentYear}-01-01`)
    await page.getByLabel('期末').fill(currentMonthDate(28))
    await expect(foodRow.getByText('￥11,500')).toBeVisible()

    // 年月プルダウンに戻し、「今年」プリセットでも1月分を含む年間集計になることを確認する
    await page.getByLabel('年月で指定').check()
    await page.getByRole('button', { name: '今年' }).click()
    await expect(foodRow.getByText('￥11,500')).toBeVisible()

    // 「今月」プリセットを押すと、1月分を含まない当月分のみ(￥10,000)の集計に戻る
    await page.getByRole('button', { name: '今月' }).click()
    await expect(foodRow.getByText('￥10,000')).toBeVisible()
  })
})
