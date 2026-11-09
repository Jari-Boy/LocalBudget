/**
 * 割勘・精算画面(計画Issue #153)のE2Eテスト。実ブラウザ(Chromium)で、サイドナビの「割勘・精算」から
 * 「割勘」「精算」の2タブを操作し、Web Worker + RPC層を経由して以下を検証する:
 * (1)割勘できる仕訳だけが候補になる(費用の行が無い仕訳・割勘仕訳自身は出ない)、(2)世帯メンバーとの
 * 割勘の記録と割勘履歴への表示、(3)世帯外の相手(取引先)との割勘、(4)複数の仕訳をまとめた割勘が
 * 相手ごとに1件の仕訳になる、(5)精算タブでの精算(方向ごとに精算の仕訳を起票して、バッチが精算済みになる)、
 * (6)精算前の割勘の取り消し(2回押し)。事前データは別Workerで作ってからreloadして反映する
 * (journal-entry.spec.tsと同じ方針)。旧「割勘対象選択」「割勘フォーム」「精算」「割勘履歴」の4画面の
 * E2E(expense-splitting.spec.ts)を、この1画面に合わせて書き直したもの。
 */
import { test, expect, type Page } from '@playwright/test'

interface BaseData {
  friendId: number
  expenseAccountId: number
  cashAccountId: number
  settlementBatchId: number
}

/**
 * 割勘/精算に共通して必要な世帯メンバー・取引先・科目・精算バッチ(計画Issue #133、
 * `settlement_batches`)を1つのWorker内でまとめて作成し、flush()で即座にIndexedDBへ
 * 永続化してからreloadする(journal-entry.spec.tsのsetupAccountsAndReloadと同じ、
 * 別Workerの後勝ち上書きを避ける方針)。既定の世帯メンバー(seedDefaultHouseholdMemberで
 * 1件自動作成済み)はfromMemberとして使う。立替金(資産/負債)科目はWorker起動時に
 * seedAdvanceAccountsが自動投入するため、ここでは作成しない(手動で同名の科目を作成すると
 * 科目名の一意制約に反する)。
 */
async function setupBaseData(page: Page, settlementBatchName: string): Promise<BaseData> {
  const result = await page.evaluate(async (name) => {
    const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
    const client = await createDbClient()
    await client.householdMember.create({ name: '割勘相手Bさん' })
    const friend = await client.counterparty.create({ name: '割勘相手の友人Cさん' })
    const expenseAccount = await client.account.create({
      category: 'expense',
      name: '割勘用食費',
      isReconcilable: null,
    })
    const cashAccount = await client.account.create({
      category: 'asset',
      name: '割勘用現金',
      isReconcilable: false,
    })
    const settlementBatch = await client.settlementBatch.create({ name, type: 'expense_splitting' })
    await client.autoSave.flush()
    return {
      friendId: friend.id,
      expenseAccountId: expenseAccount.id,
      cashAccountId: cashAccount.id,
      settlementBatchId: settlementBatch.id,
    }
  }, settlementBatchName)
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  return result
}

/** 元の支出仕訳(食費)を作成し、flush+reloadする */
async function createOriginalExpenseEntry(
  page: Page,
  data: Pick<BaseData, 'expenseAccountId' | 'cashAccountId'>,
  memo: string,
  amount: number,
): Promise<number> {
  const entryId = await page.evaluate(
    async ({ expenseAccountId, cashAccountId, memo: entryMemo, amount: entryAmount }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const [defaultMember] = await client.householdMember.findAll()
      const entry = await client.journalEntry.create({
        entryDate: '2026-08-01',
        memo: entryMemo,
        householdMemberId: defaultMember.id,
        lines: [
          { accountId: expenseAccountId, side: 'debit', amount: entryAmount },
          { accountId: cashAccountId, side: 'credit', amount: entryAmount },
        ],
      })
      await client.autoSave.flush()
      return entry.id
    },
    { ...data, memo, amount },
  )
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
  return entryId
}


async function waitForJournalEntryCount(page: Page, expectedCount: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          return (await client.journalEntry.findAll()).length
        }),
      { timeout: 15000 },
    )
    .toBe(expectedCount)
}

const MONEY_500 = /[¥￥]500/

/** サイドナビから割勘・精算画面を開く */
async function openSplitSettle(page: Page) {
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: '割勘・精算' }).click()
  await expect(page.getByRole('heading', { name: '割勘・精算' })).toBeVisible()
}

/** 選択ツリー(TreeSelect)のボタンを開き、名前の項目を選ぶ */
async function chooseFromTree(page: Page, triggerName: RegExp, optionName: string) {
  await page.getByRole('button', { name: triggerName }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: optionName, exact: true }).click()
}

async function splitWithMember(page: Page, memo: string) {
  await page.getByRole('checkbox', { name: `${memo}を選択` }).check()
  await chooseFromTree(page, /^分担相手/, '割勘相手Bさん')
  await page.getByRole('button', { name: '割勘を記録' }).click()
  await expect(page.getByText('割勘を記録しました')).toBeVisible()
}

test.describe('割勘タブ', () => {
  test('割勘できる仕訳だけが候補に出る(費用の行が無い仕訳・割勘仕訳自身は出ない)', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '候補テスト')
    await createOriginalExpenseEntry(page, data, '候補になる食事代', 1000)
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const [member] = await client.householdMember.findAll()
      const accounts = await client.account.findAll()
      const cash = accounts.find((a) => a.name === '割勘用現金')!
      const salary = await client.account.create({ category: 'revenue', name: '割勘用給与', isReconcilable: null })
      await client.journalEntry.create({
        entryDate: '2026-08-02',
        memo: '候補にならない給与',
        householdMemberId: member.id,
        lines: [
          { accountId: cash.id, side: 'debit', amount: 300000 },
          { accountId: salary.id, side: 'credit', amount: 300000 },
        ],
      })
      await client.autoSave.flush()
    })
    await page.reload()

    await openSplitSettle(page)
    const table = page.getByRole('region', { name: '割勘する仕訳' })
    await expect(table.getByText('候補になる食事代')).toBeVisible()
    await expect(table.getByText('候補にならない給与')).toHaveCount(0)

    await splitWithMember(page, '候補になる食事代')
    await waitForJournalEntryCount(page, 3)
    // 割勘した元の仕訳と、割勘仕訳自身(割勘の割勘)は候補から外れる
    await expect(table.getByText('候補になる食事代')).toHaveCount(0)
    await expect(table.getByText('候補になる食事代の割勘')).toHaveCount(0)
  })

  test('世帯メンバーとの割勘を記録すると、割勘履歴に相手・負担額・未精算で出る', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '履歴テスト')
    await createOriginalExpenseEntry(page, data, '履歴テストの食事代', 1000)

    await openSplitSettle(page)
    await splitWithMember(page, '履歴テストの食事代')
    await waitForJournalEntryCount(page, 2)

    const history = page.getByRole('region', { name: '割勘履歴' })
    await expect(history.getByRole('heading', { name: '過去の割勘' })).toBeVisible()
    const row = history.getByRole('row').filter({ hasText: '履歴テストの食事代' })
    await expect(row).toContainText('割勘相手Bさん')
    await expect(row).toContainText(MONEY_500)
    await expect(row).toContainText('未精算')

    // 履歴の摘要を押すと、仕訳画面へ移動せずダイアログで仕訳の詳細を見られる
    await row.getByRole('button', { name: '履歴テストの食事代' }).click()
    const dialog = page.getByRole('dialog', { name: '仕訳の詳細' })
    await expect(dialog).toContainText('履歴テストの食事代の割勘')
    await expect(page).toHaveURL(/\/journal\/splitting/)
    await dialog.getByRole('button', { name: '閉じる' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('世帯外の相手(取引先)を分担相手に選んで割勘できる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '世帯外テスト')
    await createOriginalExpenseEntry(page, data, '世帯外テストの食事代', 1000)

    await openSplitSettle(page)
    await page.getByRole('checkbox', { name: '世帯外テストの食事代を選択' }).check()
    await chooseFromTree(page, /^分担相手/, '割勘相手の友人Cさん')
    await page.getByRole('button', { name: '割勘を記録' }).click()
    await expect(page.getByText('割勘を記録しました')).toBeVisible()

    await waitForJournalEntryCount(page, 2)
    const row = page.getByRole('region', { name: '割勘履歴' }).getByRole('row').filter({ hasText: '世帯外テストの食事代' })
    await expect(row).toContainText('割勘相手の友人Cさん')
  })

  test('分担相手を選ばずに記録しようとするとエラーになり、仕訳は作られない', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '未選択テスト')
    await createOriginalExpenseEntry(page, data, '未選択テストの食事代', 1000)

    await openSplitSettle(page)
    await page.getByRole('checkbox', { name: '未選択テストの食事代を選択' }).check()
    await page.getByRole('button', { name: '割勘を記録' }).click()

    await expect(page.getByRole('alert')).toContainText('分担相手を選んでください')
    await waitForJournalEntryCount(page, 1)
  })

  test('複数の仕訳をまとめて割勘すると、同じ相手の分は1件の仕訳になる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, 'まとめテスト')
    await createOriginalExpenseEntry(page, data, 'まとめ1', 1000)
    await createOriginalExpenseEntry(page, data, 'まとめ2', 600)

    await openSplitSettle(page)
    await page.getByRole('checkbox', { name: 'まとめ1を選択' }).check()
    await page.getByRole('checkbox', { name: 'まとめ2を選択' }).check()
    await chooseFromTree(page, /^分担相手/, '割勘相手Bさん')
    await page.getByRole('button', { name: '割勘を記録' }).click()
    await expect(page.getByText('割勘を記録しました')).toBeVisible()

    // 元の2件 + 割勘の複合仕訳1件
    await waitForJournalEntryCount(page, 3)
  })

  test('精算前の割勘は履歴から2回押して取り消せる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '取り消しテスト')
    await createOriginalExpenseEntry(page, data, '取り消しテストの食事代', 1000)
    await openSplitSettle(page)
    await splitWithMember(page, '取り消しテストの食事代')
    await waitForJournalEntryCount(page, 2)

    const row = page.getByRole('region', { name: '割勘履歴' }).getByRole('row').filter({ hasText: '取り消しテストの食事代' })
    await row.getByRole('button', { name: 'この割勘を取り消す' }).click()
    await row.getByRole('button', { name: '本当に取り消す' }).click()

    await waitForJournalEntryCount(page, 1)
    await expect(page.getByRole('region', { name: '割勘する仕訳' }).getByText('取り消しテストの食事代')).toBeVisible()
  })
})

test.describe('精算タブ', () => {
  test('方向ごとに精算の仕訳を起票すると、バッチが精算済みになる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '精算テスト')
    await createOriginalExpenseEntry(page, data, '精算テストの食事代', 1000)
    await openSplitSettle(page)
    await splitWithMember(page, '精算テストの食事代')
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('tab', { name: '精算' }).click()
    const list = page.getByRole('region', { name: '精算バッチ一覧' })
    const row = list.getByRole('row').filter({ hasText: '精算テストの食事代の割勘' })
    await expect(row).toContainText(MONEY_500)
    await row.getByRole('button', { name: '精算テストの食事代の割勘' }).click()

    const panel = page.getByRole('region', { name: '選択中の精算バッチ' })
    for (const direction of ['立替金を減らす', '未払金を減らす']) {
      await panel.getByRole('group', { name: '精算の方向' }).getByRole('button', { name: new RegExp(direction) }).click()
      await panel.getByRole('button', { name: '+ 精算の仕訳を起票' }).click()
      await chooseFromTree(page, /^相手科目/, '割勘用現金')
      await expect(panel.getByLabel('金額')).toHaveValue('500')
      await panel.getByRole('button', { name: '起票してバッチに紐付け' }).click()
      await expect(panel.getByText('仕訳を起票してバッチに紐付けました').or(panel.getByText('精算済みです'))).toBeVisible()
    }

    await expect(panel.getByText('精算済みです。立替金と未払金の残高はどちらも0です。')).toBeVisible()
    await waitForJournalEntryCount(page, 4)

    // 残高が0になったバッチは精算済みの一覧に移り、そのまま精算済みとして表示される
    await expect(page.getByRole('button', { name: /^精算済み 1/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(list.getByRole('button', { name: '精算テストの食事代の割勘' })).toBeVisible()
  })

  test('精算で紐づけた行は、紐づけを解除でき、バッチの残高が元に戻る', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '解除テスト')
    await createOriginalExpenseEntry(page, data, '解除テストの食事代', 1000)
    await openSplitSettle(page)
    await splitWithMember(page, '解除テストの食事代')
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('tab', { name: '精算' }).click()
    const list = page.getByRole('region', { name: '精算バッチ一覧' })
    const row = list.getByRole('row').filter({ hasText: '解除テストの食事代の割勘' })
    await row.getByRole('button', { name: '解除テストの食事代の割勘' }).click()
    const panel = page.getByRole('region', { name: '選択中の精算バッチ' })
    await panel.getByRole('button', { name: '+ 精算の仕訳を起票' }).click()
    await chooseFromTree(page, /^相手科目/, '割勘用現金')
    await panel.getByRole('button', { name: '起票してバッチに紐付け' }).click()
    await expect(panel.getByText('仕訳を起票してバッチに紐付けました')).toBeVisible()
    await expect(row).toContainText(/[¥￥]0[¥￥]500/) // 立替金は0、未払金は残る

    await panel.getByRole('button', { name: /の紐づけを解除$/ }).click()
    await panel.getByRole('button', { name: '本当に解除する' }).click()

    await expect(panel.getByText('紐づけを解除しました')).toBeVisible()
    await expect(row).toContainText(/[¥￥]500[¥￥]500/)
    // 仕訳は削除されず、割勘仕訳・元の仕訳・精算の仕訳の3件が残る
    await waitForJournalEntryCount(page, 3)
  })

  test('未精算のバッチは、割勘仕訳ごと削除でき、元の仕訳は残る', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '削除テスト')
    await createOriginalExpenseEntry(page, data, '削除テストの食事代', 1000)
    await openSplitSettle(page)
    await splitWithMember(page, '削除テストの食事代')
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('tab', { name: '精算' }).click()
    const list = page.getByRole('region', { name: '精算バッチ一覧' })
    await list.getByRole('button', { name: '削除テストの食事代の割勘' }).click()
    const panel = page.getByRole('region', { name: '選択中の精算バッチ' })
    await panel.getByRole('button', { name: 'このバッチを削除' }).click()
    await expect(panel).toContainText('割勘仕訳1件とこのバッチを削除します')
    await panel.getByRole('button', { name: '本当に削除する' }).click()

    // 割勘仕訳だけが消え、元の仕訳は残る
    await waitForJournalEntryCount(page, 1)
    await expect(list.getByRole('button', { name: '削除テストの食事代の割勘' })).toHaveCount(0)
  })

  test('バッチ名を変更でき、変更後の名前が一覧に出る', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '名前変更テスト')
    await createOriginalExpenseEntry(page, data, '名前変更テストの食事代', 1000)
    await openSplitSettle(page)
    await splitWithMember(page, '名前変更テストの食事代')
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('tab', { name: '精算' }).click()
    await page
      .getByRole('region', { name: '精算バッチ一覧' })
      .getByRole('button', { name: '名前変更テストの食事代の割勘' })
      .click()
    const nameInput = page.getByRole('region', { name: '選択中の精算バッチ' }).getByLabel('バッチ名')
    await nameInput.fill('10月分の生活費')
    await nameInput.blur()

    await expect(
      page.getByRole('region', { name: '精算バッチ一覧' }).getByRole('button', { name: '10月分の生活費' }),
    ).toBeVisible()
  })
})
