/**
 * iOS「ホーム画面に追加」誘導ポップアップ(計画Issue #28)のE2Eテスト。
 * iOSは`beforeinstallprompt`に対応しないため、UA判定によるポップアップ表示と、
 * 「今後表示しない」チェックボックスの永続化挙動(明示的にオンにして閉じない限り
 * 再訪問のたびに再表示される)を実ブラウザで検証する。
 */
import { test, expect, devices } from '@playwright/test'

const iPhoneUserAgent = devices['iPhone 13'].userAgent

test.describe('iOS誘導ポップアップ', () => {
  test.describe('iOS(iPhone)のUser-Agentの場合', () => {
    test.use({ userAgent: iPhoneUserAgent })

    test('ポップアップが表示される', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeVisible()
    })

    test('「今後表示しない」をオンにせず閉じると、再訪問時に再度表示される', async ({
      page,
    }) => {
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'ホーム画面に追加' })
      await expect(dialog).toBeVisible()

      await page.getByRole('button', { name: '閉じる' }).click()
      await expect(dialog).toBeHidden()

      await page.reload()
      await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeVisible()
    })

    test('「今後表示しない」をオンにして閉じると、再訪問時に表示されない', async ({
      page,
    }) => {
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'ホーム画面に追加' })
      await expect(dialog).toBeVisible()

      await page.getByRole('checkbox', { name: '今後表示しない' }).check()
      await page.getByRole('button', { name: '閉じる' }).click()
      await expect(dialog).toBeHidden()

      await page.reload()
      await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeHidden()
    })

    test('表示直後は閉じるボタンにフォーカスが当たる', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeVisible()

      await expect(page.getByRole('button', { name: '閉じる' })).toBeFocused()
    })

    test('Tabキーでのフォーカス移動がダイアログ内に閉じ込められる(最後の要素から次はTabで先頭に戻る)', async ({
      page,
    }) => {
      await page.goto('/')
      await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeVisible()

      const checkbox = page.getByRole('checkbox', { name: '今後表示しない' })
      const closeButton = page.getByRole('button', { name: '閉じる' })

      await expect(closeButton).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(checkbox).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(closeButton).toBeFocused()

      await page.keyboard.press('Shift+Tab')
      await expect(checkbox).toBeFocused()
    })

    test('Escapeキーでポップアップを閉じられる', async ({ page }) => {
      await page.goto('/')
      const dialog = page.getByRole('dialog', { name: 'ホーム画面に追加' })
      await expect(dialog).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })
  })

  test('iOS以外のUser-Agentの場合ポップアップは表示されない', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('dialog', { name: 'ホーム画面に追加' })).toBeHidden()
  })
})
