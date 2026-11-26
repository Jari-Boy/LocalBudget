/**
 * historyDisplay の「操作の詳細」の表示用関数(計画Issue #295)の単体テスト。
 * 外部依存なし(純粋関数)。仕訳の変更から、一覧の対象名に使う要素、編集で変わった項目、
 * 右パネルに出す前→後の行(作成・削除は内容の一覧)、大量行の使った科目の要約、操作全体の種別の判定を検証する。
 */
import { describe, expect, it } from 'vitest'
import type { EntryChange, EntrySnapshot, OperationDetail } from '../../infrastructure/history/operationDetail'
import {
  changedFields,
  diffRows,
  entryAmount,
  entrySubjectParts,
  operationKind,
  sampleAccounts,
  summarizeAccountUsage,
} from './historyDisplay'

function snapshot(overrides: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return {
    date: '2026-11-21',
    memo: 'ランチ',
    comment: null,
    lines: [
      { side: 'debit', accountName: '食費', amount: 980 },
      { side: 'credit', accountName: '現金', amount: 980 },
    ],
    ...overrides,
  }
}

function updated(before: Partial<EntrySnapshot>, after: Partial<EntrySnapshot>): EntryChange {
  return { kind: 'updated', entryId: 1, before: snapshot(before), after: snapshot(after) }
}

describe('entryAmount / entrySubjectParts', () => {
  it('仕訳の金額は借方の合計で、対象名は摘要・日付・金額から作る', () => {
    const change: EntryChange = { kind: 'created', entryId: 1, before: null, after: snapshot() }

    expect(entryAmount(snapshot())).toBe(980)
    expect(entrySubjectParts(change)).toEqual({ memo: 'ランチ', date: '2026-11-21', amount: '¥980' })
  })

  it('削除された仕訳の対象名は、削除前の内容から作る', () => {
    const change: EntryChange = { kind: 'deleted', entryId: 1, before: snapshot({ memo: 'スーパー' }), after: null }

    expect(entrySubjectParts(change).memo).toBe('スーパー')
  })

  it('摘要が空の仕訳の摘要はnullで返す', () => {
    const change: EntryChange = { kind: 'created', entryId: 1, before: null, after: snapshot({ memo: '' }) }

    expect(entrySubjectParts(change).memo).toBeNull()
  })
})

describe('changedFields', () => {
  it('摘要と金額だけ変えた編集は、摘要と金額を返す', () => {
    const change = updated(
      {},
      {
        memo: '日替わりランチ',
        lines: [
          { side: 'debit', accountName: '食費', amount: 1180 },
          { side: 'credit', accountName: '現金', amount: 1180 },
        ],
      },
    )

    expect(changedFields(change)).toEqual(['memo', 'amount'])
  })

  it('科目を付け替えた編集は科目を返し、日付・コメントの変更も拾う', () => {
    const change = updated(
      {},
      {
        date: '2026-11-22',
        comment: 'メモ',
        lines: [
          { side: 'debit', accountName: '車両費', amount: 980 },
          { side: 'credit', accountName: '現金', amount: 980 },
        ],
      },
    )

    expect(changedFields(change)).toEqual(['date', 'comment', 'account'])
  })

  it('明細の行数が変わった編集は、明細を返す', () => {
    const change = updated({}, { lines: [{ side: 'debit', accountName: '食費', amount: 980 }] })

    expect(changedFields(change)).toContain('lines')
  })

  it('作成・削除は、変えた項目を返さない', () => {
    expect(changedFields({ kind: 'created', entryId: 1, before: null, after: snapshot() })).toEqual([])
  })
})

describe('diffRows', () => {
  it('編集は、変わった項目だけを前→後で返し、科目が同じ明細は金額だけを前後に出す', () => {
    const change = updated(
      {},
      {
        memo: '日替わりランチ',
        lines: [
          { side: 'debit', accountName: '食費', amount: 1180 },
          { side: 'credit', accountName: '現金', amount: 1180 },
        ],
      },
    )

    expect(diffRows(change)).toEqual([
      { label: { field: 'memo' }, before: 'ランチ', after: '日替わりランチ' },
      { label: { side: 'debit', account: '食費' }, before: '¥980', after: '¥1,180' },
      { label: { side: 'credit', account: '現金' }, before: '¥980', after: '¥1,180' },
    ])
  })

  it('科目を付け替えた明細は、前後の科目名と金額をそれぞれ出す', () => {
    const change = updated(
      {},
      {
        lines: [
          { side: 'debit', accountName: '車両費', amount: 980 },
          { side: 'credit', accountName: '現金', amount: 980 },
        ],
      },
    )

    expect(diffRows(change)).toEqual([
      { label: { side: 'debit', account: null }, before: '食費 ¥980', after: '車両費 ¥980' },
    ])
  })

  it('摘要を空にした編集は、後がnull(なし)になる', () => {
    expect(diffRows(updated({}, { memo: null }))).toEqual([{ label: { field: 'memo' }, before: 'ランチ', after: null }])
  })

  it('明細が増えた編集は、増えた行の前がnullになる', () => {
    const change = updated(
      { lines: [{ side: 'debit', accountName: '食費', amount: 980 }] },
      {
        lines: [
          { side: 'debit', accountName: '食費', amount: 980 },
          { side: 'credit', accountName: '現金', amount: 980 },
        ],
      },
    )

    expect(diffRows(change)).toEqual([{ label: { side: 'credit', account: null }, before: null, after: '現金 ¥980' }])
  })

  it('作成は、日付・摘要・各明細の内容を、後だけ持つ行で返す(コメントが無ければ出さない)', () => {
    const change: EntryChange = { kind: 'created', entryId: 1, before: null, after: snapshot() }

    expect(diffRows(change)).toEqual([
      { label: { field: 'date' }, before: null, after: '2026-11-21' },
      { label: { field: 'memo' }, before: null, after: 'ランチ' },
      { label: { side: 'debit', account: null }, before: null, after: '食費 ¥980' },
      { label: { side: 'credit', account: null }, before: null, after: '現金 ¥980' },
    ])
  })

  it('削除は、削除前の内容を、前だけ持つ行で返す', () => {
    const change: EntryChange = { kind: 'deleted', entryId: 1, before: snapshot({ comment: 'まとめ買い' }), after: null }

    const rows = diffRows(change)

    expect(rows.map((r) => r.after)).toEqual([null, null, null, null, null])
    expect(rows.map((r) => r.before)).toEqual(['2026-11-21', 'ランチ', 'まとめ買い', '食費 ¥980', '現金 ¥980'])
  })
})

describe('sampleAccounts', () => {
  it('仕訳の明細の科目名を重複なく返し、除外する科目(取込先)は省く', () => {
    const change: EntryChange = { kind: 'created', entryId: 1, before: null, after: snapshot() }

    expect(sampleAccounts(change)).toEqual(['食費', '現金'])
    expect(sampleAccounts(change, '現金')).toEqual(['食費'])
  })
})

describe('summarizeAccountUsage', () => {
  const usage = [
    { name: '現金', count: 248 },
    { name: '食費', count: 86 },
    { name: '交通費', count: 41 },
    { name: '日用品', count: 33 },
    { name: '通信費', count: 12 },
    { name: '書籍', count: 30 },
    { name: '雑費', count: 20 },
  ].sort((a, b) => b.count - a.count)

  it('除外する科目を除き、多い順の上位だけを返し、残りは科目数と件数の合計にまとめる', () => {
    const result = summarizeAccountUsage(usage, { exclude: '現金', top: 4 })

    expect(result.shown.map((u) => u.name)).toEqual(['食費', '交通費', '日用品', '書籍'])
    expect(result.rest).toEqual({ accounts: 2, count: 32 })
  })

  it('上位に収まるなら、残りは無い', () => {
    const result = summarizeAccountUsage(usage.slice(0, 3), { top: 4 })

    expect(result.shown).toHaveLength(3)
    expect(result.rest).toBeNull()
  })
})

describe('operationKind', () => {
  const detail = (kinds: OperationDetail['kinds']): OperationDetail => ({
    entryTotal: kinds.created + kinds.updated + kinds.deleted,
    entries: [],
    accountUsage: [],
    dateRange: { from: '2026-11-01', to: '2026-11-02' },
    kinds,
  })

  it('1種類だけの操作はその種別、複数の種類が混ざる操作はmixedを返す', () => {
    expect(operationKind(detail({ created: 3, updated: 0, deleted: 0 }))).toBe('created')
    expect(operationKind(detail({ created: 0, updated: 2, deleted: 0 }))).toBe('updated')
    expect(operationKind(detail({ created: 0, updated: 0, deleted: 5 }))).toBe('deleted')
    expect(operationKind(detail({ created: 1, updated: 0, deleted: 1 }))).toBe('mixed')
  })
})
