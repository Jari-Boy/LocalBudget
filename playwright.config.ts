import { defineConfig, devices } from '@playwright/test'

/**
 * docs/architecture.md 10章の方針(Web Worker等ブラウザ固有機能は少数の重要なフローのみ
 * Playwrightで検証する)に基づくE2Eテスト設定。File System Access連携等の既存方針と同様、
 * 対応ブラウザはChromium系のみとする。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
