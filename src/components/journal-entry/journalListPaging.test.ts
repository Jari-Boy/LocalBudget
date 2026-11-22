/**
 * 仕訳一覧の分割表示(「さらにN件表示」、計画Issue #253)の表示件数を決める純粋関数
 * resolveShownCount / nextDisplayLimit / moreButtonCount / JOURNAL_LIST_PAGE_SIZE のユニットテスト。
 * 外部依存はない(React・DB・localStorage を使わない)。
 * 検証するのは、表示件数は全体件数を超えないこと、選択中の仕訳が表示範囲の外にならないこと
 * (必要なら1ページ分ずつ広げる)、ボタンに出す件数は残りがページ分に満たなければ残り件数になること。
 */
import { describe, expect, it } from 'vitest'
import { JOURNAL_LIST_PAGE_SIZE, moreButtonCount, nextDisplayLimit, resolveShownCount } from './journalListPaging'

describe('journalListPaging', () => {
  describe('JOURNAL_LIST_PAGE_SIZE', () => {
    it('どちらの表示方式にも正のページ分の件数が決まっている', () => {
      expect(JOURNAL_LIST_PAGE_SIZE.entry).toBeGreaterThan(0)
      expect(JOURNAL_LIST_PAGE_SIZE.line).toBeGreaterThan(0)
    })
  })

  describe('resolveShownCount', () => {
    it('上限が全体件数より小さければ、上限の件数だけ表示する', () => {
      expect(resolveShownCount({ total: 1234, limit: 200, pageSize: 200, selectedIndex: -1 })).toBe(200)
    })

    it('全体件数が上限以下なら、全件を表示する', () => {
      expect(resolveShownCount({ total: 150, limit: 200, pageSize: 200, selectedIndex: -1 })).toBe(150)
    })

    it('0件なら0件', () => {
      expect(resolveShownCount({ total: 0, limit: 200, pageSize: 200, selectedIndex: -1 })).toBe(0)
    })

    it('選択中の仕訳が表示範囲内なら、上限のまま変えない', () => {
      expect(resolveShownCount({ total: 1000, limit: 200, pageSize: 200, selectedIndex: 199 })).toBe(200)
    })

    it('選択中の仕訳が表示範囲の外なら、その仕訳を含む最小のページ分まで広げる', () => {
      expect(resolveShownCount({ total: 1000, limit: 200, pageSize: 200, selectedIndex: 200 })).toBe(400)
      expect(resolveShownCount({ total: 1000, limit: 200, pageSize: 200, selectedIndex: 450 })).toBe(600)
    })

    it('広げた結果が全体件数を超えるときは、全体件数に収める', () => {
      expect(resolveShownCount({ total: 250, limit: 200, pageSize: 200, selectedIndex: 240 })).toBe(250)
    })
  })

  describe('nextDisplayLimit', () => {
    it('今の表示件数にページ分を足した件数を返す', () => {
      expect(nextDisplayLimit(200, 200)).toBe(400)
      expect(nextDisplayLimit(400, 100)).toBe(500)
    })
  })

  describe('moreButtonCount', () => {
    it('残りがページ分以上なら、ページ分の件数を返す', () => {
      expect(moreButtonCount({ total: 1234, shown: 200, pageSize: 200 })).toBe(200)
    })

    it('残りがページ分に満たなければ、残りの件数を返す', () => {
      expect(moreButtonCount({ total: 1234, shown: 1200, pageSize: 200 })).toBe(34)
    })

    it('全件を表示済みなら0(ボタンを出さない)', () => {
      expect(moreButtonCount({ total: 150, shown: 150, pageSize: 200 })).toBe(0)
      expect(moreButtonCount({ total: 0, shown: 0, pageSize: 200 })).toBe(0)
    })
  })
})
