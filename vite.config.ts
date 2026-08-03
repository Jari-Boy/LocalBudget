import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vite dev serverはCSSモジュールのHMRのため<style>タグをJSから動的に注入する。
// index.htmlのCSP(script-src 'self'、計画Issue #30)にはstyle-srcを指定していないため
// default-src 'self'にフォールバックし、このインライン注入がCSP違反として実機検証で
// 検出された。本番ビルド(vite build)ではCSSは外部ファイルとして出力されHMRも存在しない
// ため発生しない。開発体験のみを対象にdev server時にstyle-srcを緩和する。
function relaxCspForDevServer(): Plugin {
  return {
    name: 'relax-csp-for-dev-server',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/,
        `$1$2; style-src 'self' 'unsafe-inline'$3`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    relaxCspForDevServer(),
    VitePWA({
      // docs/architecture.md 7章: ランタイムキャッシュ戦略は不要(precacheのみ)なため
      // generateSW戦略を採用する(injectManifestは過剰、計画Issue #28参照)。
      strategies: 'generateSW',
      // 自動更新はDB書き込み中の強制リロードでトランザクションを破壊するリスクがあるため
      // 採用せず、ユーザー確認型(prompt for update)とする。
      registerType: 'prompt',
      // SW登録はsrc/components/UpdateBanner.tsxのuseRegisterSW(virtual:pwa-register/react)
      // に一本化する。injectRegister: 'auto'(既定)のままだとHTMLに自動注入される
      // registerSW.js側でも独立にregister()が呼ばれ二重登録となり、useRegisterSW側の
      // updatefound検出が阻害されることを実機検証で確認したため無効化する。
      injectRegister: false,
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
