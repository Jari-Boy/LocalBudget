/**
 * 仕訳の絞り込み(計画Issue #314)のE2Eテスト。実ブラウザ(Chromium)で仕訳画面の絞り込みを開き、
 * (1)「借方・貸方を分けて検索」で、借方の科目だけを指定すると借方に持つ仕訳だけに絞られる(まとめて指定すると両側の仕訳が残る)、
 * (2)期間ははじめ月の選択で、月の選択欄に「指定なし」があり、「日付で指定」のチェックで日付入力にも切り替えられる、
 * (3)金額のスライダーをキーボードで動かすと、数字入力に金額が入る、ことを検証する。
 * 事前データは別Workerで作ってからreloadして反映する(journal-entry.spec.tsと同じ方針)。
 */
import { test, expect, type Page } from '@playwright/test'

async function setupEntries(page: Page) {
  await page.evaluate(async () => {
    const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
    const client = await createDbClient()
    const food = await client.account.create({ category: 'expense', name: 'E2E食費', isReconcilable: null })
    const cash = await client.account.create({ category: 'asset', name: 'E2E現金', isReconcilable: false })
    const bank = await client.account.create({ category: 'asset', name: 'E2E預金', isReconcilable: false })
    const [member] = await client.householdMember.findAll()
    // 食費を現金で払った仕訳(現金は貸方)
    await client.journalEntry.create({
      entryDate: '2026-10-05',
      memo: 'e2e-現金で食費',
      householdMemberId: member.id,
      lines: [
        { householdMemberId: member.id, accountId: food.id, side: 'debit', amount: 1200 },
        { householdMemberId: member.id, accountId: cash.id, side: 'credit', amount: 1200 },
      ],
    })
    // 預金から現金を引き出した仕訳(現金は借方)
    await client.journalEntry.create({
      entryDate: '2026-10-06',
      memo: 'e2e-引き出し',
      householdMemberId: member.id,
      lines: [
        { householdMemberId: member.id, accountId: cash.id, side: 'debit', amount: 5000 },
        { householdMemberId: member.id, accountId: bank.id, side: 'credit', amount: 5000 },
      ],
    })
    await client.autoSave.flush()
  })
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
}

async function openFilter(page: Page) {
  await page.getByRole('link', { name: '仕訳', exact: true }).click()
  await page.getByRole('button', { name: '絞り込みを開く' }).click()
  return page.getByRole('search', { name: '仕訳の絞り込み' })
}

async function pick(page: Page, panel: ReturnType<Page['getByRole']>, label: string, name: string) {
  await panel.getByRole('button', { name: new RegExp(`^${label}:`) }).click()
  const popup = page.getByRole('dialog', { name: label })
  await popup.getByRole('searchbox').fill(name)
  await popup.getByRole('button', { name, exact: true }).click()
  await page.keyboard.press('Escape')
}

test.describe('仕訳の絞り込み: 借方・貸方・期間・金額', () => {
  test('借方・貸方を分けて検索すると、借方に持つ仕訳だけに絞られる(まとめてなら両側が残る)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupEntries(page)
    const panel = await openFilter(page)

    // まとめて: 現金を借方・貸方のどちらかに持つ2件
    await pick(page, panel, '科目', 'E2E現金')
    await expect(panel.getByRole('status')).toHaveText('2件')

    // 借方・貸方を分ける(まとめての条件は消える)→ 借方の科目に現金を指定: 引き出しの1件だけ
    await panel.getByRole('checkbox', { name: '借方・貸方を分けて検索' }).check()
    // まとめての科目の条件が消えたので、全件(2件)に戻る
    await expect(panel.getByRole('status')).toHaveText('2件')
    await pick(page, panel.getByRole('group', { name: '借方の条件' }), '借方の科目', 'E2E現金')
    await expect(panel.getByRole('status')).toHaveText('1件')

    // 貸方の科目にも現金を指定すると、両方を満たす仕訳は無い
    await pick(page, panel.getByRole('group', { name: '貸方の条件' }), '貸方の科目', 'E2E現金')
    await expect(panel.getByRole('status')).toHaveText('0件')
  })

  test('期間ははじめ月の選択で「指定なし」があり、「日付で指定」のチェックで日付入力に切り替えられる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupEntries(page)
    const panel = await openFilter(page)

    // はじめは月で選ぶ(チェックなし)。月の選択欄は新しい順に並び、先頭が「指定なし」
    await expect(panel.getByRole('checkbox', { name: '日付で指定' })).not.toBeChecked()
    const from = panel.getByRole('combobox', { name: '期間の開始' })
    await expect(from.getByRole('option', { name: '指定なし' })).toHaveCount(1)

    await from.selectOption('2026-10')
    await panel.getByRole('combobox', { name: '期間の終了' }).selectOption('2026-10')
    await expect(panel.getByRole('status')).toHaveText('2件')

    // 日付に戻すと、月初〜月末の日付が入っている
    await panel.getByRole('checkbox', { name: '日付で指定' }).check()
    await expect(panel.getByLabel('期間の開始')).toHaveValue('2026-10-01')
    await expect(panel.getByLabel('期間の終了')).toHaveValue('2026-10-31')
  })

  test('金額のスライダーをキーボードで動かすと、数字入力に金額が入って絞り込まれる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await setupEntries(page)
    const panel = await openFilter(page)

    const lower = panel.getByRole('slider', { name: '金額の下限のスライダー' })
    await lower.focus()
    // 目盛り 0〜1,000円 の区間の10%分(PageUp)=500円
    await page.keyboard.press('PageUp')
    await expect(panel.getByRole('textbox', { name: '金額の下限' })).toHaveValue('500')

    // 上限の摘みを右端から1つ左へ。右端(上限なし)でなくなり、上限の数字入力に値が入る
    const upper = panel.getByRole('slider', { name: '金額の上限のスライダー' })
    await upper.focus()
    await page.keyboard.press('PageDown')
    await expect(panel.getByRole('textbox', { name: '金額の上限' })).not.toHaveValue('')
  })
})
