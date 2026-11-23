/**
 * 仕訳一覧の分割表示(「さらにN件表示」、計画Issue #253)の1回の表示件数 JOURNAL_LIST_PAGE_SIZE のユニットテスト。
 * 外部依存はない(React・DB・localStorage を使わない)。
 * 表示件数を決める関数は共通部品に移したので、そのテストは common/list-paging/listPaging.test.ts にある。
 */
import { describe, expect, it } from 'vitest'
import { JOURNAL_LIST_PAGE_SIZE } from './journalListPaging'

describe('journalListPaging', () => {
  describe('JOURNAL_LIST_PAGE_SIZE', () => {
    it('どちらの表示方式にも正のページ分の件数が決まっている', () => {
      expect(JOURNAL_LIST_PAGE_SIZE.entry).toBeGreaterThan(0)
      expect(JOURNAL_LIST_PAGE_SIZE.line).toBeGreaterThan(0)
    })
  })
})
