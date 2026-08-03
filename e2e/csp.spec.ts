/**
 * CSP(Content Security Policy)設定(計画Issue #30)のテスト。
 * docs/architecture.md 11章の方針(script-src 'self'・インラインスクリプト禁止)が
 * index.htmlのmetaタグとして実際に有効化されており、かつsql.js(SQLite WASM)を
 * 使ったWorker RPC層(Issue #24)がそのCSP制約下でもCSP違反を出さずに動作することを
 * 検証する。metaタグ内容の検証はソースファイルを直接読み、本番相当の厳格な値である
 * ことを確認する(vite.config.tsのrelaxCspForDevServerはdev server実行時のみ
 * style-src 'unsafe-inline'を注入するため、実ブラウザ経由の検証では緩和後の値しか
 * 見えず本番の厳格さを検証できない)。
 * 外部依存: Playwright(実ブラウザ、ネットワークアクセスなし、Vite dev serverはlocalhost)。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

test.describe('CSP設定', () => {
  test('index.html(ビルド前ソース)にscript-src \'self\'を含むCSP metaタグが設定されている', () => {
    const indexHtmlPath = fileURLToPath(new URL('../index.html', import.meta.url))
    const html = readFileSync(indexHtmlPath, 'utf-8')
    const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)

    expect(match).not.toBeNull()
    const content = match?.[1]
    expect(content).toContain("script-src 'self'")
    // 'wasm-unsafe-eval'はsql.js(WASM)実行に必須(下記テストで実機検証)。
    // 任意JS文字列を実行できる'unsafe-eval'とは別物であり、それが含まれないことを確認する。
    expect(content).toContain("'wasm-unsafe-eval'")
    expect(content).not.toContain('unsafe-inline')
    expect(content).not.toContain("'unsafe-eval'")
  })

  test('CSP設定下でsql.js(WASM)を使ったWorker RPCが違反を出さずに動作する', async ({ page }) => {
    const cspViolations: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy|Refused to/.test(msg.text())) {
        cspViolations.push(msg.text())
      }
    })

    await page.goto('/')

    const accountName = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const account = await client.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      })
      return (await client.account.findById(account.id))?.name
    })

    expect(accountName).toBe('食費')
    expect(cspViolations).toEqual([])
  })
})
