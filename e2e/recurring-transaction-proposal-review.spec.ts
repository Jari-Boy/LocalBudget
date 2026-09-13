/**
 * 定期取引の提案レビュー画面(計画Issue #39)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面(仕訳ハブ)からの遷移、#121が提供するlistPending/confirm RPCを経由した
 * 保留中の提案一覧表示、「そのルールについて最も古い対象日のみ確認操作ができる」制約
 * (docs/domain/recurring-transactions.md 1.2節、confirmは昇順のみ許可)、レビュー時の
 * 金額編集(2.1節)、ルールにhouseholdMemberIdが未設定の場合に起票者を選択するまで
 * 確認できない挙動を検証する。個々の表示ロジックの詳細はコンポーネントテスト
 * (RecurringTransactionProposalReviewScreen.test.tsx)側で検証済みのため、ここでは
 * 画面遷移・確認順序制約・金額編集・起票者未設定という操作フローに絞る。
 *
 * 対象日はテスト実行時の実際の日付を起点に算出する(recurringTransactionProposalの
 * 評価は「前回チェック日(生成済み仕訳の最新entry_date)」を起点にした実時刻ベースの
 * 計算のため、Playwrightのブラウザ内時刻を固定する仕組みは導入していない)。
 * 生成済み仕訳の永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、
 * listPendingの結果に反映されるまでpollで待ってからreloadする。
 */
import { test, expect, type Page } from '@playwright/test'

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function waitForPendingProposalCount(page: Page, expectedCount: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          return (await client.recurringTransactionProposal.listPending()).length
        }),
      { timeout: 10000 },
    )
    .toBe(expectedCount)
}

async function openProposalReviewScreen(page: Page) {
  await page.getByRole('button', { name: '仕訳' }).click()
  await page.getByRole('button', { name: '定期取引の確認' }).click()
}

test.describe('定期取引の確認画面', () => {
  test('保留中の提案が表示され、確認すると仕訳が生成されて一覧から消える', async ({ page }) => {
    await page.goto('/')
    const dayOfWeek = new Date().getUTCDay()

    await page.evaluate(
      async ({ dayOfWeek, seedEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const expenseAccount = await client.account.create({
          category: 'expense',
          name: '通信費(提案テスト1)',
          isReconcilable: null,
        })
        const liabilityAccount = await client.account.create({
          category: 'liability',
          name: '未払金(提案テスト1)',
          isReconcilable: false,
        })
        const [defaultMember] = await client.householdMember.findAll()
        const rule = await client.recurringTransactionRule.create({
          name: 'サブスクA',
          debitAccountId: expenseAccount.id,
          creditAccountId: liabilityAccount.id,
          amount: 1000,
          frequency: 'weekly',
          dayOfWeek,
          householdMemberId: defaultMember.id,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          lines: [
            { accountId: expenseAccount.id, side: 'debit', amount: 1000 },
            { accountId: liabilityAccount.id, side: 'credit', amount: 1000 },
          ],
        })
      },
      { dayOfWeek, seedEntryDate: isoDate(-7) },
    )
    await waitForPendingProposalCount(page, 1)
    await page.reload()

    await openProposalReviewScreen(page)
    await expect(page.getByText('サブスクA')).toBeVisible()

    await page.getByRole('button', { name: '確認して仕訳を作成する' }).click()

    await expect(page.getByText('確認待ちの定期取引がありません')).toBeVisible()
  })

  test('同一ルールに複数の保留中対象日がある場合、最も古い対象日から順にしか確認できない', async ({ page }) => {
    await page.goto('/')
    const dayOfWeek = new Date().getUTCDay()

    await page.evaluate(
      async ({ dayOfWeek, seedEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const expenseAccount = await client.account.create({
          category: 'expense',
          name: '通信費(提案テスト2)',
          isReconcilable: null,
        })
        const liabilityAccount = await client.account.create({
          category: 'liability',
          name: '未払金(提案テスト2)',
          isReconcilable: false,
        })
        const [defaultMember] = await client.householdMember.findAll()
        const rule = await client.recurringTransactionRule.create({
          name: 'サブスクB',
          debitAccountId: expenseAccount.id,
          creditAccountId: liabilityAccount.id,
          amount: 2000,
          frequency: 'weekly',
          dayOfWeek,
          householdMemberId: defaultMember.id,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          lines: [
            { accountId: expenseAccount.id, side: 'debit', amount: 2000 },
            { accountId: liabilityAccount.id, side: 'credit', amount: 2000 },
          ],
        })
      },
      // 3週間前を起点に、毎週分(3件)を保留中対象日として発生させる
      { dayOfWeek, seedEntryDate: isoDate(-21) },
    )
    await waitForPendingProposalCount(page, 3)
    await page.reload()

    await openProposalReviewScreen(page)

    await expect(page.getByText(isoDate(-14))).toBeVisible()
    await expect(page.getByText(isoDate(-7))).not.toBeVisible()
    await expect(page.getByRole('button', { name: '確認して仕訳を作成する' })).toHaveCount(1)
    await expect(page.getByText('ほか2件が保留中です(古い順に確認してください)')).toBeVisible()

    await page.getByRole('button', { name: '確認して仕訳を作成する' }).click()

    await expect(page.getByText(isoDate(-7))).toBeVisible()
    await expect(page.getByText('ほか1件が保留中です(古い順に確認してください)')).toBeVisible()
  })

  test('ルールにhouseholdMemberIdが未設定の場合、世帯メンバーを選択するまで確認できず、金額も編集して確認できる', async ({
    page,
  }) => {
    await page.goto('/')
    const dayOfWeek = new Date().getUTCDay()

    await page.evaluate(
      async ({ dayOfWeek, seedEntryDate }) => {
        const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
        const client = await createDbClient()
        const expenseAccount = await client.account.create({
          category: 'expense',
          name: '通信費(提案テスト3)',
          isReconcilable: null,
        })
        const liabilityAccount = await client.account.create({
          category: 'liability',
          name: '未払金(提案テスト3)',
          isReconcilable: false,
        })
        const [defaultMember] = await client.householdMember.findAll()
        const rule = await client.recurringTransactionRule.create({
          name: 'サブスクC',
          debitAccountId: expenseAccount.id,
          creditAccountId: liabilityAccount.id,
          amount: 3000,
          frequency: 'weekly',
          dayOfWeek,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          lines: [
            { accountId: expenseAccount.id, side: 'debit', amount: 3000 },
            { accountId: liabilityAccount.id, side: 'credit', amount: 3000 },
          ],
        })
      },
      { dayOfWeek, seedEntryDate: isoDate(-7) },
    )
    await waitForPendingProposalCount(page, 1)
    await page.reload()

    await openProposalReviewScreen(page)
    await expect(page.getByText('サブスクC')).toBeVisible()

    await expect(page.getByRole('button', { name: '確認して仕訳を作成する' })).toBeDisabled()

    await page.getByLabel('金額').fill('3500')
    const memberOptions = await page.getByLabel('起票者(世帯メンバー)を選択してください').locator('option').all()
    const memberValue = await memberOptions[1].getAttribute('value')
    await page.getByLabel('起票者(世帯メンバー)を選択してください').selectOption(memberValue!)

    await expect(page.getByRole('button', { name: '確認して仕訳を作成する' })).toBeEnabled()
    await page.getByRole('button', { name: '確認して仕訳を作成する' }).click()

    await expect(page.getByText('確認待ちの定期取引がありません')).toBeVisible()

    // 生成済み仕訳の永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、新規clientから
    // 読み取って確認できるまでpollで待つ(project-management.spec.ts等と同様のパターン)。
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            const entries = await client.journalEntry.findAll()
            return entries.some((e) => e.lines.every((l) => l.amount === 3500))
          }),
        { timeout: 10000 },
      )
      .toBe(true)
  })
})
