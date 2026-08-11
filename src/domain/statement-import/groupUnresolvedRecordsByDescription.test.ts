/**
 * groupUnresolvedRecordsByDescription(docs/domain/statement-import.md 1.5手順6
 * 「摘要のグルーピングによる一括割当て」)のユニットテスト。外部依存なしの純粋関数。
 */
import { describe, expect, it } from 'vitest'
import { groupUnresolvedRecordsByDescription } from './groupUnresolvedRecordsByDescription'

describe('groupUnresolvedRecordsByDescription', () => {
  it('正規化後の摘要が同じレコードが2件以上ある場合、まとめて1グループとして返す', () => {
    const groups = groupUnresolvedRecordsByDescription([
      { index: 0, description: 'イオン　○○店' },
      { index: 1, description: 'ｲｵﾝ　○○店'.normalize('NFKC') },
      { index: 3, description: 'イオン　○○店' },
    ])

    expect(groups).toEqual([
      { normalizedDescription: 'イオン○○店', recordIndices: [0, 1, 3] },
    ])
  })

  it('全角半角・大文字小文字・空白の表記ゆれを正規化した上でグルーピングする', () => {
    const groups = groupUnresolvedRecordsByDescription([
      { index: 0, description: 'AMAZON.CO.JP' },
      { index: 1, description: 'amazon.co.jp' },
    ])

    expect(groups).toEqual([
      { normalizedDescription: 'AMAZON.CO.JP', recordIndices: [0, 1] },
    ])
  })

  it('同じ摘要のレコードが1件のみの場合はグループを返さない(一括割当ての対象にならないため)', () => {
    const groups = groupUnresolvedRecordsByDescription([
      { index: 0, description: 'スーパー' },
      { index: 1, description: 'コンビニ' },
    ])

    expect(groups).toEqual([])
  })

  it('レコードが0件の場合は空配列を返す', () => {
    expect(groupUnresolvedRecordsByDescription([])).toEqual([])
  })

  it('複数の摘要グループが存在する場合、それぞれ別グループとして返す', () => {
    const groups = groupUnresolvedRecordsByDescription([
      { index: 0, description: 'スーパー' },
      { index: 1, description: 'コンビニ' },
      { index: 2, description: 'スーパー' },
      { index: 3, description: 'コンビニ' },
    ])

    expect(groups).toEqual([
      { normalizedDescription: 'スーパー', recordIndices: [0, 2] },
      { normalizedDescription: 'コンビニ', recordIndices: [1, 3] },
    ])
  })
})
