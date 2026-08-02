/**
 * 日付をロケールに応じた表示用文字列に変換するformatDateのユニットテスト。
 * Intl.DateTimeFormatをラップし、ドメイン層のDate/文字列をUI表示直前にのみ
 * ロケール依存の表記へ変換する用途を想定する(docs/architecture.md 13章)。
 * 外部依存なし。
 */
import { describe, expect, test } from 'vitest'
import { formatDate } from './formatDate'

describe('formatDate', () => {
  test('既定ロケール(ja-JP)で年/月/日の表示形式に変換する', () => {
    const date = new Date('2026-08-03T00:00:00Z')
    expect(formatDate(date)).toBe(new Intl.DateTimeFormat('ja-JP').format(date))
  })

  test('ロケールを明示的に指定した場合はそのロケールでフォーマットされる', () => {
    const date = new Date('2026-08-03T00:00:00Z')
    expect(formatDate(date, 'en-US')).toBe(new Intl.DateTimeFormat('en-US').format(date))
  })
})
