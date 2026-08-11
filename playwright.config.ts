import { defineConfig, devices } from '@playwright/test'

/**
 * docs/architecture.md 10章の方針(Web Worker等ブラウザ固有機能は少数の重要なフローのみ
 * Playwrightで検証する)に基づくE2Eテスト設定。File System Access連携等の既存方針と同様、
 * 対応ブラウザはChromium系のみとする。
 */
export default defineConfig({
  testDir: './e2e',
  // PWA関連(*.pwa.spec.ts)はビルド済み成果物(dist/)をpreviewサーバーで配信する
  // 専用のplaywright.pwa.config.tsで実行するため、通常のdevサーバー実行対象からは除外する。
  testIgnore: /.*\.pwa\.spec\.ts/,
  fullyParallel: true,
  /**
   * CI環境(GitHub Actions)限定でworkers数を1に固定する暫定回避策。複数のE2Eテストが
   * 固定名のIndexedDBデータベース(IndexedDBStorageAdapter、docs/decisions.md参照)を
   * 直接操作しており、CI環境の並列実行下でPlaywrightのBrowserContext分離が機能して
   * いないかのようなデータ競合(タイミング違いの上書き・消失)が実機で複数パターン
   * 観測された(計画Issue #80で根本原因を調査中)。ローカル開発では並列実行を維持し
   * フィードバック速度を落とさない。
   */
  workers: process.env.CI ? 1 : undefined,
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
