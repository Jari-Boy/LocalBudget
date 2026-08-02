/**
 * vite-plugin-pwa(generateSW戦略)導入によるビルド成果物を検証する統合テスト。
 * 外部依存: 実際に`npm run build`を実行し、生成された`dist/`配下を検証する
 * (Vite/Workboxの出力そのものが対象のため、モックでは代替できない)。
 * docs/architecture.md 7章の「Service Worker生成の自動化」「Web App Manifest」を
 * ビルド成果物のレベルで確認する。
 */
import { describe, expect, test, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '../../..')
const distDir = resolve(projectRoot, 'dist')

interface WebAppManifestIcon {
  src: string
  sizes: string
  purpose?: string
}

interface WebAppManifest {
  name: string
  short_name: string
  display: string
  theme_color: string
  icons: WebAppManifestIcon[]
}

describe('vite-plugin-pwaによるビルド成果物', () => {
  let manifest: WebAppManifest

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: projectRoot,
      stdio: 'pipe',
      shell: true,
    })
    manifest = JSON.parse(
      readFileSync(resolve(distDir, 'manifest.webmanifest'), 'utf-8'),
    ) as WebAppManifest
  }, 180_000)

  test('Service Worker(sw.js)がビルド成果物に含まれる', () => {
    expect(existsSync(resolve(distDir, 'sw.js'))).toBe(true)
  })

  test('Web App Manifest(manifest.webmanifest)がビルド成果物に含まれる', () => {
    expect(existsSync(resolve(distDir, 'manifest.webmanifest'))).toBe(true)
  })

  test('Web App Manifestがname/short_name/display: standalone/theme_colorを含む標準構成である', () => {
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.short_name.length).toBeGreaterThan(0)
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  test('Web App Manifestのiconsに192x192・512x512・maskableサイズが含まれ、各ファイルが実在する', () => {
    const has192 = manifest.icons.some((icon) => icon.sizes === '192x192')
    const has512 = manifest.icons.some((icon) => icon.sizes === '512x512')
    const hasMaskable = manifest.icons.some((icon) => icon.purpose?.includes('maskable'))

    expect(has192).toBe(true)
    expect(has512).toBe(true)
    expect(hasMaskable).toBe(true)

    for (const icon of manifest.icons) {
      const iconPath = resolve(distDir, icon.src.replace(/^\//, ''))
      expect(existsSync(iconPath)).toBe(true)
    }
  })
})
