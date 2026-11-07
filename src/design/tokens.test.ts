/**
 * デザイントークン(src/design/tokens.css)のテスト(計画Issue #150)。
 * 承認済みモックアップの値(色・文字サイズ・角丸・余白・影・フォント)が
 * CSSカスタムプロパティとして1か所で定義され、モックアップと一致していることを検証する。
 * あわせて、フォント(IBM Plex Sans JP)がnpmパッケージ同梱で読み込まれ、
 * オフラインでもPWAのprecacheで配信されることを検証する。
 * 外部依存: ファイルシステム(tokens.css・fonts.ts・vite.config.tsの読み込みのみ)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const tokensCss = readFileSync(resolve(__dirname, 'tokens.css'), 'utf-8')

/** :root直下のカスタムプロパティを{名前: 値}に展開する。 */
function parseTokens(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    result[match[1]] = match[2].trim()
  }
  return result
}

/** ディレクトリ配下の*.cssを再帰的に列挙する。 */
function listCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name)
    if (statSync(path).isDirectory()) return listCssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

const tokens = parseTokens(tokensCss)

describe('デザイントークン', () => {
  it.each([
    ['--color-bg', '#F4F6F4'],
    ['--color-surface', '#FFFFFF'],
    ['--color-text', '#1C2622'],
    ['--color-text-muted', '#55635D'],
    ['--color-border', '#D5DBD7'],
    ['--color-border-soft', '#E8ECE9'],
    ['--color-border-strong', '#BFC8C3'],
    ['--color-hover', '#EEF2EF'],
    ['--color-field-subtle', '#F1F4F2'],
    ['--color-accent', '#0B6B5B'],
    ['--color-accent-hover', '#084E43'],
    ['--color-accent-soft', '#E6F0ED'],
    ['--color-danger', '#B3261E'],
    ['--color-warning-text', '#8A4B00'],
    ['--color-nav-bg', '#17231F'],
    ['--color-nav-active', '#2F443D'],
    ['--color-nav-text', '#E8EEEB'],
    ['--color-nav-muted', '#BFD0C9'],
  ])('色トークン%sがモックアップの値%sと一致する', (name, value) => {
    expect(tokens[name]?.toUpperCase()).toBe(value)
  })

  it.each([
    ['--color-tag-blue-bg', '#E1ECF7'],
    ['--color-tag-blue-text', '#14497A'],
    ['--color-tag-neutral-bg', '#EEF2EF'],
    ['--color-tag-neutral-text', '#3D4A44'],
    ['--color-tag-orange-bg', '#F7E7D6'],
    ['--color-tag-orange-text', '#7A4300'],
    ['--color-tag-purple-bg', '#EDE5F5'],
    ['--color-tag-purple-text', '#54307A'],
    ['--color-tag-yellow-bg', '#FFF3D6'],
    ['--color-tag-yellow-text', '#6B4A00'],
  ])('出どころタグの色トークン%sがモックアップの値%sと一致する', (name, value) => {
    expect(tokens[name]?.toUpperCase()).toBe(value)
  })

  it.each([
    ['--font-size-xs', '12px'],
    ['--font-size-sm', '13px'],
    ['--font-size-base', '14px'],
    ['--font-size-nav', '15px'],
    ['--font-size-brand', '17px'],
    ['--font-size-title', '22px'],
  ])('文字サイズトークン%sがモックアップの値%sと一致する', (name, value) => {
    expect(tokens[name]).toBe(value)
  })

  it.each([
    ['--radius-xs', '4px'],
    ['--radius-sm', '5px'],
    ['--radius-md', '6px'],
    ['--radius-lg', '8px'],
  ])('角丸トークン%sがモックアップの値%sと一致する', (name, value) => {
    expect(tokens[name]).toBe(value)
  })

  it('ポップアップの影とフォントファミリがモックアップの値と一致する', () => {
    expect(tokens['--shadow-popup']).toBe('0 6px 18px rgba(23, 35, 31, 0.18)')
    expect(tokens['--font-sans']).toBe("'IBM Plex Sans JP', system-ui, sans-serif")
  })

  it('余白・コントロール高さ・サイドナビ幅のトークンを持つ', () => {
    expect(tokens['--space-main-y']).toBe('24px')
    expect(tokens['--space-main-x']).toBe('28px')
    expect(tokens['--control-height']).toBe('36px')
    expect(tokens['--control-height-sm']).toBe('30px')
    expect(tokens['--nav-item-height']).toBe('44px')
    expect(tokens['--nav-width']).toBe('200px')
  })

  it('トークンの定義はこのファイル1か所に限る(他のCSSで--color-*を再定義しない)', () => {
    const others = listCssFiles(resolve(root, 'src')).filter(
      (file) => resolve(file) !== resolve(__dirname, 'tokens.css'),
    )
    for (const file of others) {
      expect(readFileSync(file, 'utf-8'), file).not.toMatch(/--color-[a-z-]+\s*:/)
    }
  })
})

describe('フォント同梱', () => {
  it('IBM Plex Sans JPの400/500/600/700をnpmパッケージから読み込む', () => {
    const fonts = readFileSync(resolve(__dirname, 'fonts.ts'), 'utf-8')
    for (const weight of [400, 500, 600, 700]) {
      expect(fonts).toContain(`@fontsource/ibm-plex-sans-jp/${weight}.css`)
    }
    expect(fonts).not.toContain('fonts.googleapis.com')
  })

  it('フォントファイル(woff2)をオフライン用にprecache対象へ含める', () => {
    const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf-8')
    expect(viteConfig).toMatch(/globPatterns:\s*\[[^\]]*woff2/)
  })
})
