/**
 * 定期取引ルール管理画面(計画Issue #39)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、frequency(weekly/monthly日付指定/monthly曜日指定/yearly)ごとに
 * 入力項目が切り替わる条件分岐フォームでの新規作成、編集、および「生成済み仕訳が0件なら
 * 物理削除可、1件以上なら理由表示の上で非アクティブ化のみ」という削除可否の分岐
 * (docs/domain/recurring-transactions.md 1.6節)が実際のWeb Worker + RPC層を経由して
 * 機能することを検証する。個々の表示ロジックの詳細はコンポーネントテスト
 * (RecurringTransactionRuleManagementScreen.test.tsx)側で検証済みのため、ここでは
 * 画面遷移・frequency切り替え・削除可否分岐という操作フローに絞る。
 * project-management.spec.tsと同様、DB書き込みの永続化はwithAutoSaveのtrailing
 * debounce(2秒)を挟むため、作成したデータがRepository経由で確認できるまでpollで待って
 * からreloadする。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForRuleCreated(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const rules = await client.recurringTransactionRule.findAll()
          return rules.some((r) => r.name === targetName)
        }, name),
      { timeout: 10000 },
    )
    .toBe(true)
}

async function waitForAccountCreated(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const accounts = await client.account.findAll()
          return accounts.some((a) => a.name === targetName)
        }, name),
      { timeout: 10000 },
    )
    .toBe(true)
}

/** 借方/貸方科目に「未払金」等の負債科目は既定シード(defaultAccountSeedData)に含まれないため、
 * ルール作成フォームの検証用に専用の費用・負債科目を先に登録しておく。 */
async function seedRuleAccounts(page: Page) {
  await page.evaluate(async () => {
    const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
    const client = await createDbClient()
    await client.account.create({ category: 'liability', name: '未払金(定期取引テスト)', isReconcilable: false })
  })
  await waitForAccountCreated(page, '未払金(定期取引テスト)')
  await page.reload()
}

test.describe('定期取引ルール管理画面', () => {
  test('frequencyごとに入力項目が切り替わり、weekly/monthly(日付)/monthly(曜日)/yearlyそれぞれで作成・編集できる', async ({
    page,
  }) => {
    await page.goto('/')
    await seedRuleAccounts(page)
    await page.getByRole('button', { name: 'マスタ管理' }).click()
    await page.getByRole('button', { name: '定期取引を管理する' }).click()
    await expect(page.getByText('登録済みの定期取引ルールがありません')).toBeVisible()

    // weekly
    await page.getByRole('button', { name: '定期取引ルールを追加' }).click()
    await page.getByLabel('ルール名').fill('お小遣い')
    await page.getByLabel('借方科目').selectOption({ label: '通信費' })
    await page.getByLabel('貸方科目').selectOption({ label: '未払金(定期取引テスト)' })
    await page.getByLabel('金額').fill('1000')
    await page.getByLabel('繰り返し').selectOption('weekly')
    await page.getByLabel('曜日').selectOption('1')
    await page.getByRole('button', { name: '作成する' }).click()
    const weeklyItem = page.getByRole('listitem').filter({ hasText: 'お小遣い' })
    await expect(weeklyItem).toBeVisible()
    await expect(weeklyItem).toContainText('毎週月曜日')

    // 編集: weeklyからmonthly(日付指定)へfrequencyを変更する(他のルール作成前に行い、
    // 後続で作成する「お小遣い(第2土曜日)」との名前の部分一致を避ける)
    await weeklyItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('繰り返し').selectOption('monthly')
    await page.getByLabel('日', { exact: true }).fill('15')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(weeklyItem).toContainText('毎月15日')

    // monthly(日付指定、既定モード)
    await page.getByRole('button', { name: '定期取引ルールを追加' }).click()
    await page.getByLabel('ルール名').fill('家賃')
    await page.getByLabel('借方科目').selectOption({ label: '通信費' })
    await page.getByLabel('貸方科目').selectOption({ label: '未払金(定期取引テスト)' })
    await page.getByLabel('金額').fill('80000')
    await page.getByLabel('繰り返し').selectOption('monthly')
    await page.getByLabel('日', { exact: true }).fill('1')
    await page.getByRole('button', { name: '作成する' }).click()
    const rentItem = page.getByRole('listitem').filter({ hasText: '家賃' })
    await expect(rentItem).toBeVisible()
    await expect(rentItem).toContainText('毎月1日')

    // monthly(曜日指定への切り替え)
    await page.getByRole('button', { name: '定期取引ルールを追加' }).click()
    await page.getByLabel('ルール名').fill('お小遣い(第2土曜日)')
    await page.getByLabel('借方科目').selectOption({ label: '通信費' })
    await page.getByLabel('貸方科目').selectOption({ label: '未払金(定期取引テスト)' })
    await page.getByLabel('金額').fill('3000')
    await page.getByLabel('繰り返し').selectOption('monthly')
    await page.getByLabel('指定方法').selectOption('weekday')
    await page.getByLabel('第◯週').selectOption('2')
    await page.getByLabel('曜日').selectOption('6')
    await page.getByRole('button', { name: '作成する' }).click()
    const biweeklyItem = page.getByRole('listitem').filter({ hasText: 'お小遣い(第2土曜日)' })
    await expect(biweeklyItem).toBeVisible()
    await expect(biweeklyItem).toContainText('毎月第2土曜日')

    // yearly
    await page.getByRole('button', { name: '定期取引ルールを追加' }).click()
    await page.getByLabel('ルール名').fill('保険料')
    await page.getByLabel('借方科目').selectOption({ label: '通信費' })
    await page.getByLabel('貸方科目').selectOption({ label: '未払金(定期取引テスト)' })
    await page.getByLabel('金額').fill('12000')
    await page.getByLabel('繰り返し').selectOption('yearly')
    await page.getByLabel('月').selectOption('6')
    await page.getByLabel('日', { exact: true }).fill('1')
    await page.getByRole('button', { name: '作成する' }).click()
    const insuranceItem = page.getByRole('listitem').filter({ hasText: '保険料' })
    await expect(insuranceItem).toBeVisible()
    await expect(insuranceItem).toContainText('毎年6月1日')

    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'マスタ管理' })).toBeVisible()
  })

  test('生成済み仕訳が0件のルールは削除でき、1件以上あるルールは理由表示の上で非アクティブ化のみ可能', async ({
    page,
  }) => {
    await page.goto('/')

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expenseAccount = await client.account.create({
        category: 'expense',
        name: '通信費(定期)',
        isReconcilable: null,
      })
      const liabilityAccount = await client.account.create({
        category: 'liability',
        name: '未払金(定期)',
        isReconcilable: false,
      })
      const [defaultMember] = await client.householdMember.findAll()

      await client.recurringTransactionRule.create({
        name: '未使用ルール',
        debitAccountId: expenseAccount.id,
        creditAccountId: liabilityAccount.id,
        amount: 500,
        frequency: 'weekly',
        dayOfWeek: 0,
      })
      const usedRule = await client.recurringTransactionRule.create({
        name: '記帳済みルール',
        debitAccountId: expenseAccount.id,
        creditAccountId: liabilityAccount.id,
        amount: 500,
        frequency: 'weekly',
        dayOfWeek: 0,
        householdMemberId: defaultMember.id,
      })
      await client.journalEntry.create({
        entryDate: '2026-07-06',
        memo: null,
        householdMemberId: defaultMember.id,
        generatedFromRuleId: usedRule.id,
        lines: [
          { accountId: expenseAccount.id, side: 'debit', amount: 500 },
          { accountId: liabilityAccount.id, side: 'credit', amount: 500 },
        ],
      })
    })
    await waitForRuleCreated(page, '記帳済みルール')
    await page.reload()

    await page.getByRole('button', { name: 'マスタ管理' }).click()
    await page.getByRole('button', { name: '定期取引を管理する' }).click()

    const unusedItem = page.getByRole('listitem').filter({ hasText: '未使用ルール' })
    await unusedItem.getByRole('button', { name: '削除' }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '未使用ルール' })).toHaveCount(0)

    const usedItem = page.getByRole('listitem').filter({ hasText: '記帳済みルール' })
    await expect(usedItem.getByRole('button', { name: '削除' })).toHaveCount(0)
    await expect(usedItem.getByText('生成済みの仕訳があるため削除できません(非アクティブ化のみ可能です)')).toBeVisible()

    await usedItem.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(usedItem.getByText('非アクティブ', { exact: true })).toBeVisible()
  })
})
