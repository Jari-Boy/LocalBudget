/**
 * 仕訳テンプレート(計画Issue #201)のE2Eテスト。実ブラウザ(Chromium)で、仕訳画面の「テンプレート」タブから
 * テンプレートを追加して保存し、「テンプレートから起票」のダイアログで選ぶと「新しい仕訳」へ内容が入り、
 * 金額を入れて保存すると仕訳が作られることを、実際のWeb Worker + RPC層とマイグレーション(バージョン2で追加した
 * テンプレートの表)を通して検証する。ダイアログの検索・キーボード操作・グループ・並び替え・警告などの
 * 詳細はコンポーネントテスト(src/components/journal-template/*.test.tsx、JournalScreen.test.tsx)側で検証済み。
 * DB書き込みの永続化はwithAutoSaveのtrailing debounce(2秒)を挟むため、Repository経由で反映を確認するまでpollで待つ。
 */
import { test, expect } from '@playwright/test'

test.describe('仕訳テンプレート', () => {
  test('テンプレートを追加し、「テンプレートから起票」で選んで金額を入れて保存すると、仕訳が作られる', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await page.getByRole('link', { name: '仕訳', exact: true }).click()

    // 「テンプレート」タブで追加して保存する
    await page.getByRole('tab', { name: 'テンプレート' }).click()
    await page.getByRole('button', { name: 'テンプレートを追加' }).click()
    const editor = page.getByRole('region', { name: 'テンプレートの編集' })
    await editor.getByLabel('名称').fill('E2Eコンビニ')
    await editor.getByLabel('摘要(任意)').fill('E2E昼食')
    // 追加した直後は科目が空なので、選ぶまで保存できない
    await expect(editor.getByRole('button', { name: '保存' })).toBeDisabled()
    await expect(editor.getByText('科目が未選択の行があります')).toBeVisible()
    for (const [side, account] of [['借方', '食費'], ['貸方', '現金']] as const) {
      await editor.getByRole('group', { name: side }).getByRole('button', { name: /^科目/ }).click()
      const picker = page.getByRole('dialog', { name: '科目' })
      await picker.getByRole('searchbox', { name: '科目を検索' }).fill(account)
      await picker.getByRole('button', { name: account, exact: true }).click()
    }
    await editor.getByRole('button', { name: '保存' }).click()
    await expect(page.getByRole('button', { name: 'E2Eコンビニ', exact: true })).toBeVisible()

    // 「テンプレートから起票」のダイアログで選ぶ
    await page.getByRole('button', { name: 'テンプレートから起票' }).click()
    const dialog = page.getByRole('dialog', { name: 'テンプレートから起票' })
    await expect(dialog.getByRole('searchbox', { name: 'テンプレートを検索' })).toBeFocused()
    await dialog.getByRole('searchbox', { name: 'テンプレートを検索' }).fill('E2E')
    await dialog.getByRole('button', { name: 'このテンプレートで起票' }).click()

    // 「新しい仕訳」にテンプレートの内容が入る
    const detail = page.getByRole('region', { name: '仕訳の詳細' })
    await expect(detail.getByRole('heading', { name: '新しい仕訳' })).toBeVisible()
    await expect(detail.getByLabel('摘要(任意)')).toHaveValue('E2E昼食')
    await expect(detail.getByText('テンプレート「E2Eコンビニ」の内容を入れました。金額を入力してください。')).toBeVisible()

    // 金額を入れて保存すると、仕訳が作られる
    const amounts = detail.getByLabel(/の金額$/)
    await amounts.nth(0).fill('700')
    await amounts.nth(1).fill('700')
    await detail.getByRole('button', { name: '保存', exact: true }).click()

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
            const client = await createDbClient()
            const entries = await client.journalEntry.findAll()
            const templates = await client.journalTemplate.findAll()
            const entry = entries.find((e) => e.memo === 'E2E昼食')
            return {
              templateName: templates.find((t) => t.name === 'E2Eコンビニ')?.name ?? null,
              amounts: entry?.lines.map((l) => l.amount) ?? null,
            }
          }),
        { timeout: 10000 },
      )
      .toEqual({ templateName: 'E2Eコンビニ', amounts: [700, 700] })
  })
})
