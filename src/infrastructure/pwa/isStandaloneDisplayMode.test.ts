/**
 * PWAが既にホーム画面から起動されている(スタンドアロン表示)かどうかを判定する
 * 関数のユニットテスト。既にインストール済みの場合、iOS誘導ポップアップ
 * (計画Issue #28)を表示する必要がないため、この判定結果で表示要否を絞り込む。
 */
import { describe, expect, test, afterEach, vi } from 'vitest'
import { isStandaloneDisplayMode } from './isStandaloneDisplayMode'

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches } as unknown as MediaQueryList),
  )
}

describe('isStandaloneDisplayMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('navigator.standaloneがtrueの場合(iOS Safariのホーム画面起動)trueを返す', () => {
    stubMatchMedia(false)
    vi.stubGlobal('navigator', { standalone: true })

    expect(isStandaloneDisplayMode()).toBe(true)
  })

  test('display-mode: standaloneにマッチする場合trueを返す', () => {
    stubMatchMedia(true)
    vi.stubGlobal('navigator', {})

    expect(isStandaloneDisplayMode()).toBe(true)
  })

  test('どちらにも該当しない場合falseを返す', () => {
    stubMatchMedia(false)
    vi.stubGlobal('navigator', {})

    expect(isStandaloneDisplayMode()).toBe(false)
  })
})
