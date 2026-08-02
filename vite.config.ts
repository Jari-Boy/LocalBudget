import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // docs/architecture.md 7章: ランタイムキャッシュ戦略は不要(precacheのみ)なため
      // generateSW戦略を採用する(injectManifestは過剰、計画Issue #28参照)。
      strategies: 'generateSW',
      // 自動更新はDB書き込み中の強制リロードでトランザクションを破壊するリスクがあるため
      // 採用せず、ユーザー確認型(prompt for update)とする。
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'LocalBudget',
        short_name: 'LocalBudget',
        description: 'サーバーと通信せずブラウザ内でデータを保持する家計簿PWA',
        display: 'standalone',
        theme_color: '#aa3bff',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // アプリシェル(HTML/CSS/JS/WASMバイナリ/アイコン)をprecache対象にする。
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,ico,webmanifest}'],
      },
    }),
  ],
})
