import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/**
 * public/favicon.svgを唯一のソースとして、PWAマニフェスト用アイコン一式
 * (192x192/512x512/maskable/apple-touch-icon等)を機械的に生成する設定。
 * 正式なデザイン素材は将来差し替え前提(docs/architecture.md 7章、計画Issue #28)。
 */
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/favicon.svg'],
})
