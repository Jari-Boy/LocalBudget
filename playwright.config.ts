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
  /**
   * CI環境限定でリトライを1回許容する。計画Issue #80はworkers:1適用後もなお、CI環境
   * 限定でごく低頻度に発生するFOREIGN KEY constraint failed等の非決定的な失敗(複数の
   * 異なるテストで散発し、ローカルでは繰り返し実行しても再現しない)を根本原因未解明の
   * まま追跡中(計画Issue #136で調査したが、構造的な原因特定には至らなかった)。
   * リトライは症状を隠す対症療法である点を認識した上で、低頻度のCI環境依存の揺らぎに対する
   * 実用的な緩和策として導入する。ローカル開発では原因の見落としを避けるためリトライしない。
   */
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // 開発モード限定のダミーサンプルデータ投入(seedDevSampleDataIfDev、計画Issue #101)は
    // npm run devの手動確認向けの利便性機能であり、E2Eテストが期待する「口座・仕訳が0件」の
    // クリーンな初期状態と衝突する。VITE_DISABLE_DEV_SEEDはVite起動時にimport.meta.envへ
    // 伝播するprocess.env由来のVITE_プレフィックス変数であり、これによりE2Eテスト実行中の
    // 開発サーバーに限りダミーデータ投入を抑制する(通常のnpm run devでの手動起動には影響しない)。
    env: { VITE_DISABLE_DEV_SEED: 'true' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
