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
 */
export function seedDevSampleDataIfDev(db: Database): void {
  if (import.meta.env.DEV) {
    seedDevSampleData(db)
  }
}
