import type { Database } from 'sql.js'
import { seedDevSampleData } from './seedDevSampleData'

/**
 * 開発モード(import.meta.env.DEV)の場合にのみseedDevSampleDataを呼び出す薄いラッパー
 * (計画Issue #101)。db.worker.tsのmain()はWeb Worker環境(self/postMessage等)に依存し
 * Vitestで直接インポート・実行できないため、import.meta.env.DEVによる分岐だけをこの
 * 独立したモジュールに切り出すことでテスト可能にしている。本番ビルド(vite build)では
 * import.meta.env.DEVがビルド時にfalseへ静的置換されるため、Vite/Rollupのtree-shakingにより
 * seedDevSampleData(および投入するダミーデータの文字列)ごと本番バンドルから除去される想定
 * (完了条件により dist/ 配下のテキスト検索で確認する)。
 * import.meta.env.VITE_DISABLE_DEV_SEEDが"true"の場合はDEVがtrueでも投入を抑制する。
 * Playwright E2Eテスト(npm run test:e2e)はnpm run devの開発サーバーに対して実行されるため、
 * DEVモードの利便性(ダミーデータ)とE2Eテストが期待するクリーンな初期状態が衝突する
 * (playwright.config.tsのwebServerがこの環境変数を設定してE2Eテスト実行時のみ投入を止める)。
 */
export function seedDevSampleDataIfDev(db: Database): void {
  if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_DEV_SEED !== 'true') {
    seedDevSampleData(db)
  }
}
