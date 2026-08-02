/**
 * isFileSystemAccessSupported() のユニットテスト。File System Access API
 * (showDirectoryPicker) が現在の実行環境で利用可能かどうかを静的に判定する
 * (docs/architecture.md 4.2節、計画Issue #57)。ブラウザ環境を`window`への
 * プロパティ有無で模倣し、Vitest(Node環境)上でユニットテストする。
 * 外部依存: なし。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFileSystemAccessSupported } from './isFileSystemAccessSupported'

describe('isFileSystemAccessSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('windowにshowDirectoryPickerが存在する場合はtrueを返す', () => {
    vi.stubGlobal('window', { showDirectoryPicker: () => {} })

    expect(isFileSystemAccessSupported()).toBe(true)
  })

  it('windowにshowDirectoryPickerが存在しない場合はfalseを返す(Firefox/Safari等)', () => {
    vi.stubGlobal('window', {})

    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('windowグローバル自体が存在しない場合はfalseを返す(Web Worker内等)', () => {
    vi.stubGlobal('window', undefined)

    expect(isFileSystemAccessSupported()).toBe(false)
  })
})
