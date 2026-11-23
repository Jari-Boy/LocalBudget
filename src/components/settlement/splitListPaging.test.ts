/**
 * 割勘画面の分割表示(「さらにN件表示」、計画Issue #268)の1回の表示件数 SPLIT_LIST_PAGE_SIZE のユニットテスト。
 * 外部依存はない(React・DB を使わない)。
 * 割勘する仕訳の候補・割勘履歴とも150件ずつであることを固定する(仕訳ページと同じ150件。
 * 件数を変えるときはこのテストと docs の記述をあわせて直す)。
 */
import { describe, expect, it } from 'vitest'
import { SPLIT_LIST_PAGE_SIZE } from './splitListPaging'

describe('splitListPaging', () => {
  describe('SPLIT_LIST_PAGE_SIZE', () => {
    it('割勘する仕訳の候補は150件ずつ表示する', () => {
      expect(SPLIT_LIST_PAGE_SIZE.candidate).toBe(150)
    })

    it('割勘履歴は150件ずつ表示する', () => {
      expect(SPLIT_LIST_PAGE_SIZE.history).toBe(150)
    })
  })
})
