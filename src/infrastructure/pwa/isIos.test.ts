/**
 * User-Agent文字列からiOSデバイス(iPhone/iPad/iPod)かどうかを判定する純粋関数の
 * ユニットテスト。iOS Safariは`beforeinstallprompt`に対応しないため、「ホーム画面に
 * 追加」誘導ポップアップ(計画Issue #28)の表示要否判定に使う。
 */
import { describe, expect, test } from 'vitest'
import { isIos } from './isIos'

describe('isIos', () => {
  test('iPhoneのUser-Agentに対してtrueを返す', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(isIos(ua)).toBe(true)
  })

  test('iPadのUser-Agentに対してtrueを返す', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(isIos(ua)).toBe(true)
  })

  test('AndroidのUser-Agentに対してfalseを返す', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(isIos(ua)).toBe(false)
  })

  test('デスクトップChromeのUser-Agentに対してfalseを返す', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(isIos(ua)).toBe(false)
  })
})
