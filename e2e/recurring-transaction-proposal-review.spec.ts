/**
 * 定期仕訳の提案の確認(計画Issue #39、計画Issue #152で仕訳画面の「承認待ちの定期仕訳」タブに統合)のE2Eテスト。
 * 実ブラウザ(Chromium)でサイドナビの「仕訳」から「承認待ちの定期仕訳」タブへ移り、
 * #121が提供するlistPending/confirm/skip RPCを経由した
 * 保留中の提案一覧表示、「そのルールについて最も古い対象日のみ確認操作ができる」制約
 * (docs/domain/recurring-transactions.md 1.2節、confirmは昇順のみ許可)、レビュー時の
 * 金額編集(2.1節)、ルールにhouseholdMemberIdが未設定の場合に起票者を選択するまで
 * 確認できない挙動、見送りを検証する。個々の表示ロジックの詳細はコンポーネントテスト
 * (JournalScreen.test.tsx)側で検証済みのため、ここでは
 * 画面遷移・確認順序制約・金額編集・起票者未設定という操作フローに絞る。
 *
 * 対象日はテスト実行時の実際の日付を起点に算出する(recurringTransactionProposalの
 * 評価は「前回チェック日(生成済み仕訳の最新の期日recurring_due_date、開始日の前日など)」を起点にした実時刻ベースの
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
  // 確認待ちの提案があるとき、サイドナビの「仕訳」には件数のバッジが付く(計画Issue #150)
  const journalLink = page.getByRole('link', { name: /^仕訳 \d+$/ })
  await expect(journalLink).toBeVisible({ timeout: 10000 })
  await journalLink.click()
  await page.getByRole('tab', { name: /^承認待ち/ }).click()
}

const detailPanel = (page: Page) => page.getByRole('region', { name: '仕訳の詳細' })
const proposalRows = (page: Page) => page.locator('.journal-result-list__row')

test.describe('承認待ちの定期仕訳(仕訳画面のタブ)', () => {
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
          lines: [
            { side: 'debit', accountId: expenseAccount.id, amount: 1000 },
            { side: 'credit', accountId: liabilityAccount.id, amount: 1000 },
          ],
          frequency: 'weekly',
          dayOfWeek,
          // 開始日を最初の生成済みの期日と同じ日にして、その次の対象日から提案させる(計画Issue #164)
          startsOn: seedEntryDate,
          bookkeeperHouseholdMemberId: defaultMember.id,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          recurringDueDate: seedEntryDate,
          lines: [
            { householdMemberId: defaultMember.id, accountId: expenseAccount.id, side: 'debit', amount: 1000 },
            { householdMemberId: defaultMember.id, accountId: liabilityAccount.id, side: 'credit', amount: 1000 },
          ],
        })
      },
      { dayOfWeek, seedEntryDate: isoDate(-7) },
    )
    await waitForPendingProposalCount(page, 1)
    await page.reload()

    await openProposalReviewScreen(page)
    await expect(proposalRows(page).filter({ hasText: 'サブスクA' })).toBeVisible()

    await detailPanel(page).getByRole('button', { name: '承認して仕訳帳に反映', exact: true }).click()

    await expect(page.getByRole('tab', { name: '承認待ち 0' })).toBeVisible()
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
          lines: [
            { side: 'debit', accountId: expenseAccount.id, amount: 2000 },
            { side: 'credit', accountId: liabilityAccount.id, amount: 2000 },
          ],
          frequency: 'weekly',
          dayOfWeek,
          // 開始日を最初の生成済みの期日と同じ日にして、その次の対象日から提案させる(計画Issue #164)
          startsOn: seedEntryDate,
          bookkeeperHouseholdMemberId: defaultMember.id,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          recurringDueDate: seedEntryDate,
          lines: [
            { householdMemberId: defaultMember.id, accountId: expenseAccount.id, side: 'debit', amount: 2000 },
            { householdMemberId: defaultMember.id, accountId: liabilityAccount.id, side: 'credit', amount: 2000 },
          ],
        })
      },
      // 3週間前を起点に、毎週分(3件)を保留中対象日として発生させる
      { dayOfWeek, seedEntryDate: isoDate(-21) },
    )
    await waitForPendingProposalCount(page, 3)
    await page.reload()

    await openProposalReviewScreen(page)

    await expect(proposalRows(page)).toHaveCount(3)
    // 2件目以降(新しい提案)は、古い提案が残っている間は確定も見送りもできない
    await proposalRows(page).nth(1).click()
    await expect(detailPanel(page).getByRole('button', { name: '承認して仕訳帳に反映', exact: true })).toBeDisabled()
    await expect(detailPanel(page).getByRole('button', { name: '今回は見送る' })).toBeDisabled()
    await expect(detailPanel(page).getByText('先に同じルールの古い提案を確定するか見送ってください')).toBeVisible()

    await proposalRows(page).nth(0).click()
    await detailPanel(page).getByRole('button', { name: '承認して仕訳帳に反映', exact: true }).click()

    await expect(page.getByRole('tab', { name: '承認待ち 2' })).toBeVisible()
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
          lines: [
            { side: 'debit', accountId: expenseAccount.id, amount: 3000 },
            { side: 'credit', accountId: liabilityAccount.id, amount: 3000 },
          ],
          frequency: 'weekly',
          dayOfWeek,
          // 開始日を最初の生成済みの期日と同じ日にして、その次の対象日から提案させる(計画Issue #164)
          startsOn: seedEntryDate,
        })
        await client.journalEntry.create({
          entryDate: seedEntryDate,
          memo: null,
          householdMemberId: defaultMember.id,
          generatedFromRuleId: rule.id,
          recurringDueDate: seedEntryDate,
          lines: [
            { householdMemberId: defaultMember.id, accountId: expenseAccount.id, side: 'debit', amount: 3000 },
            { householdMemberId: defaultMember.id, accountId: liabilityAccount.id, side: 'credit', amount: 3000 },
          ],
        })
      },
      { dayOfWeek, seedEntryDate: isoDate(-7) },
    )
    await waitForPendingProposalCount(page, 1)
    await page.reload()

    await openProposalReviewScreen(page)
    await expect(proposalRows(page).filter({ hasText: 'サブスクC' })).toBeVisible()

    const confirm = detailPanel(page).getByRole('button', { name: '承認して仕訳帳に反映', exact: true })
    await expect(confirm).toBeDisabled()

    await detailPanel(page).getByLabel('通信費(提案テスト3)の金額').fill('3500')
    const memberSelect = detailPanel(page).locator('select.journal-screen__select')
    const memberOptions = await memberSelect.locator('option').all()
    const memberValue = await memberOptions[1].getAttribute('value')
    await memberSelect.selectOption(memberValue!)

    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(page.getByRole('tab', { name: '承認待ち 0' })).toBeVisible()

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
