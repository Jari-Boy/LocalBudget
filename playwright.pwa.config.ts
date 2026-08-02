import { defineConfig, devices } from '@playwright/test'

/**
 * Service Worker(vite-plugin-pwa generateSW戦略)によるアプリシェルprecache・
 * オフライン起動を検証するための専用設定。
 * Service Workerは本番ビルド(dist/)でのみ生成されるため、通常のe2e(devサーバー)
 * とは別に、ビルド済み成果物をpreviewサーバーで配信して検証する(計画Issue #28)。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.pwa\.spec\.ts/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
