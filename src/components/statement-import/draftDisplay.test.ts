/**
 * draftDisplay(明細取込の一時保存の表示用の純粋関数、計画Issue #231 フェーズ3)のユニットテスト。
 * DBに持つ保存日時(UTCの 'YYYY-MM-DD HH:MM:SS')を、利用者の端末の時刻の 'YYYY/MM/DD HH:mm' に直すことを検証する。
 * タイムゾーンに依存しないよう、直した結果を端末の時刻として読み戻し、元の時刻(UTC)と分まで一致するかで確かめる。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { formatDraftSavedAt } from './draftDisplay'

describe('formatDraftSavedAt', () => {
  it('UTCの保存日時を、端末の時刻の「YYYY/MM/DD HH:mm」にする(秒は出さない)', () => {
    const text = formatDraftSavedAt('2026-11-19 05:32:48')

    expect(text).toMatch(/^\d{4}\/\d\d\/\d\d \d\d:\d\d$/)
    // 端末の時刻として読み戻すと、元のUTCの時刻と、分まで同じ時点になる
    const [date, time] = text.split(' ')
    const [y, mo, d] = date.split('/').map(Number)
    const [h, mi] = time.split(':').map(Number)
    expect(new Date(y, mo - 1, d, h, mi).getTime()).toBe(Date.UTC(2026, 10, 19, 5, 32, 0))
  })

  it('読めない文字列は、そのまま返す(画面を壊さない)', () => {
    expect(formatDraftSavedAt('不明')).toBe('不明')
  })
})
