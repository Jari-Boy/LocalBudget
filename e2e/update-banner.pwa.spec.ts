/**
 * 更新確認UI(useRegisterSWベースのバナー)のE2Eテスト。
 * docs/architecture.md 7章の方針(自動更新はDB書き込み中の強制リロードで
 * トランザクションを破壊するリスクがあるため採用しない)により、新しいService
 * Workerを検出しても自動更新せず、ユーザーが「更新する」を選択するまで
 * 現在の画面での作業を継続できることを検証する(計画Issue #28)。
 *
 * 新バージョンのデプロイは、ビルド済みdist/sw.jsを直接書き換えることで模擬する。
 * Service Worker自体のスクリプト取得リクエストはPlaywrightの
 * page.route/context.routeではインターセプトできない(Service Workerプロセスが
 * ブラウザ内部から直接フェッチするため)ことを実機検証で確認したため、この方式を
 * 採用した。vite previewサーバーはリクエストの都度ファイルシステムから読み直すため、
 * dist/sw.js書き換え後にregistration.update()を呼べば新しいSWとして検出される。
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const swPath = resolve(import.meta.dirname, '../dist/sw.js')

async function waitForServiceWorkerController(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), {
    timeout: 30_000,
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
    timeout: 30_000,
  })
}

async function triggerNewServiceWorkerVersion(page: Page) {
  const original = readFileSync(swPath, 'utf-8')
  writeFileSync(swPath, `${original}\n// e2e-${Date.now()}`)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  })
  return () => writeFileSync(swPath, original)
}

test.describe('更新確認バナー', () => {
  test('新しいService Workerを検出すると非モーダルのバナーが表示され、作業を継続できる', async ({
    page,
  }) => {
    await waitForServiceWorkerController(page)
    const restore = await triggerNewServiceWorkerVersion(page)

    try {
      // role="alert"はARIA仕様上Name from: authorであり、aria-label等の明示指定が
      // ない限り子要素テキストからアクセシブルネームは自動計算されない。
      // そのためgetByRole('alert', { name })ではなくroleのみで特定し、
      // テキスト内容はtoHaveTextで確認する。
      const banner = page.getByRole('alert')
      await expect(banner).toBeVisible({ timeout: 30_000 })
      await expect(banner).toHaveText('新しいバージョンが利用可能です')

      // 非モーダル: バナー表示中も背後のページ操作がブロックされない
      await expect(page.locator('#root')).toBeVisible()
      await expect(page.locator('#root')).not.toBeEmpty()
    } finally {
      await restore()
    }
  })

  test('「更新する」を選択するとService Workerが更新され、ページがリロードされる', async ({
    page,
  }) => {
    await waitForServiceWorkerController(page)
    const restore = await triggerNewServiceWorkerVersion(page)

    try {
      const updateButton = page.getByRole('button', { name: '更新する' })
      await expect(updateButton).toBeVisible({ timeout: 30_000 })

      const reloadPromise = page.waitForEvent('load')
      await updateButton.click()
      await reloadPromise
    } finally {
      await restore()
    }
  })
})
