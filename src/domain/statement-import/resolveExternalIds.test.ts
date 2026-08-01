/**
 * resolveExternalIds(重複防止のための外部取引ID解決、docs/domain/statement-import.md 1.2・1.6)の
 * 純粋関数としてのユニットテスト。CSVにexternal_id列があればそれをそのまま使い、無ければ
 * entry_date/description/amountから同期の非暗号学的ハッシュ(自前実装)を生成して代替することを
 * 検証する。あわせて、同一バッチ内に(entry_date, description, amount)が完全一致する複数レコードが
 * 存在する場合でも、出現順インデックスにより異なるIDが生成されること(Issue #19実装着手前レビューで
 * 判明した、UNIQUE(account_id, external_id)制約違反を防ぐための対応)を検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportedRecord } from './ImportedRecord'
import { resolveExternalIds } from './resolveExternalIds'

function record(overrides: Partial<ImportedRecord> = {}): ImportedRecord {
  return {
    entryDate: '2026-07-20',
    description: 'セブンイレブン 日本橋店',
    amount: -150,
    balanceAfter: null,
    externalId: null,
    isSettled: null,
    ...overrides,
  }
}

describe('CSVにexternal_id列がある場合', () => {
  it('CSV由来のexternalIdをそのまま使う', () => {
    const ids = resolveExternalIds([record({ externalId: 'TX-001' })])

    expect(ids).toEqual(['TX-001'])
  })
})

describe('CSVにexternal_id列が無い場合(正規化ハッシュで代替)', () => {
  it('同じ内容のレコードには同じハッシュを、異なる内容には異なるハッシュを生成する', () => {
    const ids = resolveExternalIds([
      record({ entryDate: '2026-07-20', description: 'A', amount: -100 }),
      record({ entryDate: '2026-07-20', description: 'B', amount: -100 }),
    ])

    expect(ids[0]).not.toBe(ids[1])
  })

  it('生成されるハッシュは同期的に決定的である(同じ入力なら同じ出力)', () => {
    const input = record({ entryDate: '2026-07-20', description: 'A', amount: -100 })

    const first = resolveExternalIds([input])
    const second = resolveExternalIds([input])

    expect(first).toEqual(second)
  })

  it('CSV由来とハッシュ由来が1バッチに混在してもそれぞれ正しく解決される', () => {
    const ids = resolveExternalIds([
      record({ externalId: 'TX-001' }),
      record({ entryDate: '2026-07-21', description: 'B', amount: 500 }),
    ])

    expect(ids[0]).toBe('TX-001')
    expect(ids[1]).not.toBe('TX-001')
  })
})

describe('同一バッチ内に完全一致するレコードが複数存在する場合', () => {
  it('同日・同摘要・同金額の取引が複数回発生しても異なる外部IDを生成する', () => {
    // 同じコンビニで同じ商品を同日中に2回購入したケース(Issue #19レビューで発見)
    const duplicateContentRecord = record({
      entryDate: '2026-08-01',
      description: 'セブンイレブン 日本橋店',
      amount: -150,
    })

    const ids = resolveExternalIds([duplicateContentRecord, duplicateContentRecord])

    expect(ids[0]).not.toBe(ids[1])
    expect(new Set(ids).size).toBe(2)
  })

  it('3回以上の完全一致でもすべて異なる外部IDになる', () => {
    const duplicateContentRecord = record({
      entryDate: '2026-08-01',
      description: '駐車場代',
      amount: -300,
    })

    const ids = resolveExternalIds([
      duplicateContentRecord,
      duplicateContentRecord,
      duplicateContentRecord,
    ])

    expect(new Set(ids).size).toBe(3)
  })

  it('再度同じバッチ(同じ順序)を解決すると同じ外部ID列を再現する(再取込時の完全一致検知に必要)', () => {
    const rows: ImportedRecord[] = [
      record({ entryDate: '2026-08-01', description: 'セブンイレブン', amount: -150 }),
      record({ entryDate: '2026-08-01', description: 'セブンイレブン', amount: -150 }),
    ]

    const first = resolveExternalIds(rows)
    const second = resolveExternalIds(rows)

    expect(first).toEqual(second)
  })
})
