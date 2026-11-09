/**
 * 分析画面(計画Issue #155)のE2Eテスト。実ブラウザ(Chromium)で、サイドナビの「分析」から
 * 「財務諸表」「グラフ分析」「予算」の3タブを操作し、Web Worker + RPC層を経由して以下を検証する:
 * (1)財務諸表タブにPLとBSが並び、貸借が一致する、(2)グラフ分析タブの主要な数字と、グラフの内訳の
 * 仕訳行(クリックで固定表示)から仕訳一覧へ移動できる、(3)予算タブで入力した予算がリロードしても
 * 残る(永続化される)。個々の集計・表示の詳細はコンポーネントテスト(AnalysisScreen・ChartsTab・
 * BudgetTab)側で検証済みのため、ここでは実ブラウザでの重要フローに絞る。事前データは別Workerで作り、
 * flush()でIndexedDBへ永続化してからreloadして反映する(journal-entry.spec.tsと同じ方針)。
 * 日付は実行時の「今月」を基準に動的に決める(月の10日を使い、実行日に関わらず今月の範囲に収める)。
 */
import { test, expect, type Page } from '@playwright/test'

function currentMonthDate(day: number): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function setupData(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  await page.evaluate(
    async ({ entryDate }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const [member] = await client.householdMember.findAll()
      const cash = await client.account.create({ category: 'asset', name: '分析用現金', isReconcilable: false })
      const salary = await client.account.create({ category: 'revenue', name: '分析用給与', isReconcilable: null })
      const food = await client.account.create({ category: 'expense', name: '分析用食費', isReconcilable: null })
      await client.journalEntry.create({
        entryDate,
        memo: '分析用の給料',
        householdMemberId: member.id,
        lines: [
          { householdMemberId: member.id, accountId: cash.id, side: 'debit', amount: 200000 },
          { householdMemberId: member.id, accountId: salary.id, side: 'credit', amount: 200000 },
        ],
      })
      await client.journalEntry.create({
        entryDate,
        memo: '分析用のスーパー',
        householdMemberId: member.id,
        lines: [
          { householdMemberId: member.id, accountId: food.id, side: 'debit', amount: 3000 },
          { householdMemberId: member.id, accountId: cash.id, side: 'credit', amount: 3000 },
        ],
      })
      await client.autoSave.flush()
    },
    { entryDate: currentMonthDate(10) },
  )
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
}

async function openAnalysis(page: Page) {
  await page.getByRole('link', { name: '分析', exact: true }).click()
  await expect(page.getByRole('heading', { name: '分析', level: 1 })).toBeVisible()
}

test.describe('分析画面', () => {
  test('財務諸表タブにPLとBSが並び、貸借が一致する', async ({ page }) => {
    await setupData(page)
    await openAnalysis(page)

    const pl = page.getByRole('region', { name: '損益計算書(PL)' })
    await expect(pl.getByText('分析用食費')).toBeVisible()
    const bs = page.getByRole('region', { name: '貸借対照表(BS)' })
    await expect(bs.getByText('分析用現金')).toBeVisible()
    await expect(bs.getByText(/貸借が一致しています/)).toBeVisible()
  })

  test('グラフ分析タブで内訳の行を固定表示し、押すと仕訳一覧へ移動する', async ({ page }) => {
    await setupData(page)
    await openAnalysis(page)
    await page.getByRole('tab', { name: 'グラフ分析' }).click()

    await expect(page.getByText('収益', { exact: true }).first()).toBeVisible()
    const flow = page.getByRole('region', { name: '月次の収益と費用' })
    const thisMonth = new Date().getMonth() + 1
    await flow.getByRole('button', { name: new RegExp(`^${thisMonth}月`) }).click()
    await flow.getByRole('region', { name: `${thisMonth}月の内訳` }).getByRole('button', { name: /分析用のスーパー/ }).click()

    await expect(page.getByRole('heading', { name: '仕訳', level: 1 })).toBeVisible()
    await expect(page.getByText('分析用のスーパー').first()).toBeVisible()
  })

  test('予算タブで入力した予算が、リロードしても残る', async ({ page }) => {
    await setupData(page)
    await openAnalysis(page)
    await page.getByRole('tab', { name: '予算' }).click()

    const input = page.getByLabel('分析用食費の予算')
    await input.fill('5000')
    await input.blur()
    await expect(page.getByRole('region', { name: '科目別の予算' }).getByText('60%').first()).toBeVisible()

    // 画面側のWorkerの保存はデバウンス(2秒)されるため、別Workerで読み直して保存されるまで待つ。
    // 別Workerでflush()すると古い状態で上書きしてしまうため、ここでは呼ばない
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            const budgets = await client.budget.findAll()
            return budgets.map((b) => b.amount)
          }),
        { timeout: 10000 },
      )
      .toEqual([5000])
    await page.reload()
    await openAnalysis(page)
    await page.getByRole('tab', { name: '予算' }).click()
    await expect(page.getByLabel('分析用食費の予算')).toHaveValue('5000')
  })
})
