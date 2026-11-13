/**
 * 明細行単位の表の列幅(計画Issue #182)を扱う純粋関数・保存のユニットテスト。
 * 初期の列幅、幅の上限・下限への丸め、列を変えたときの新しい列幅、表全体の最小幅(借方・貸方は同じ種類の列が
 * 連動するため、借方・貸方の各列は2回数える)、初期値かどうかの判定、localStorageへの保存・復元
 * (不正な値・未知の列・localStorageが使えない環境でも壊れない)を検証する。
 * localStorage は Node/Vitest 環境にないため、スタブ(vi.stubGlobal)で置き換える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLUMN_KEYS,
  DEFAULT_COLUMN_WIDTHS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  isDefaultColumnWidths,
  loadColumnWidths,
  resizeColumn,
  saveColumnWidths,
  totalTableWidth,
} from './journalLineTableColumns'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

const STORAGE_KEY = 'localbudget:journal-line-table-column-widths'

describe('列幅の定義', () => {
  it('列は 日付・出どころ・摘要・コメントと、借方・貸方で連動する 科目・プロジェクト・取引先/精算バッチ・世帯メンバー・金額 の9種類', () => {
    expect(COLUMN_KEYS).toEqual(['date', 'source', 'memo', 'comment', 'account', 'project', 'partner', 'member', 'amount'])
  })

  it('すべての列に、上限・下限の範囲内の初期の幅がある', () => {
    for (const key of COLUMN_KEYS) {
      expect(DEFAULT_COLUMN_WIDTHS[key]).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH)
      expect(DEFAULT_COLUMN_WIDTHS[key]).toBeLessThanOrEqual(MAX_COLUMN_WIDTH)
    }
  })
})

describe('clampColumnWidth', () => {
  it('範囲内の幅はそのまま(整数に丸める)', () => {
    expect(clampColumnWidth(120)).toBe(120)
    expect(clampColumnWidth(120.6)).toBe(121)
  })

  it('下限より小さければ下限に、上限より大きければ上限に丸める', () => {
    expect(clampColumnWidth(MIN_COLUMN_WIDTH - 30)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(MAX_COLUMN_WIDTH + 500)).toBe(MAX_COLUMN_WIDTH)
  })

  it('数値でない値(NaN・Infinity)は下限に倒す', () => {
    expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('resizeColumn', () => {
  it('指定した列だけを新しい幅(丸めた値)にした、新しい列幅を返す(元は変えない)', () => {
    const next = resizeColumn(DEFAULT_COLUMN_WIDTHS, 'account', 200)
    expect(next.account).toBe(200)
    expect(next.amount).toBe(DEFAULT_COLUMN_WIDTHS.amount)
    expect(DEFAULT_COLUMN_WIDTHS.account).not.toBe(200)
  })

  it('範囲外の幅は丸められる', () => {
    expect(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'memo', 1).memo).toBe(MIN_COLUMN_WIDTH)
    expect(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'memo', 99999).memo).toBe(MAX_COLUMN_WIDTH)
  })
})

describe('totalTableWidth', () => {
  it('日付〜コメントの合計 + 借方・貸方の各列の合計 × 2(借方と貸方で連動するため)', () => {
    const w = { ...DEFAULT_COLUMN_WIDTHS, date: 100, source: 100, memo: 100, comment: 100, account: 10, project: 10, partner: 10, member: 10, amount: 10 }
    expect(totalTableWidth(w)).toBe(400 + 2 * 50)
  })
})

describe('isDefaultColumnWidths', () => {
  it('初期の列幅ならtrue、1列でも違えばfalse', () => {
    expect(isDefaultColumnWidths(DEFAULT_COLUMN_WIDTHS)).toBe(true)
    expect(isDefaultColumnWidths(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'date', 200))).toBe(false)
  })
})

describe('列幅の保存と復元', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('何も保存されていなければ、初期の列幅を返す', () => {
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
  })

  it('保存した列幅が、次回の読み込みで復元される', () => {
    saveColumnWidths(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'memo', 333))
    expect(loadColumnWidths().memo).toBe(333)
    expect(loadColumnWidths().date).toBe(DEFAULT_COLUMN_WIDTHS.date)
  })

  it('初期の列幅を保存すると、保存を消す(初期値に戻したことになる)', () => {
    saveColumnWidths(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'memo', 333))
    saveColumnWidths(DEFAULT_COLUMN_WIDTHS)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('保存された値が壊れていても(JSONでない・オブジェクトでない)、初期の列幅に倒れる', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
    localStorage.setItem(STORAGE_KEY, '[1,2,3]')
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
  })

  it('一部の列の値が不正なとき(数値でない・未知の列)は、その列だけ初期値、残りは復元する。範囲外は丸める', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ memo: 400, date: 'wide', unknown: 5, amount: 1 }))
    const loaded = loadColumnWidths()
    expect(loaded.memo).toBe(400)
    expect(loaded.date).toBe(DEFAULT_COLUMN_WIDTHS.date)
    expect(loaded.amount).toBe(MIN_COLUMN_WIDTH)
    expect(Object.keys(loaded).sort()).toEqual([...COLUMN_KEYS].sort())
  })

  it('localStorage が例外を投げても、読み込みは初期の列幅、保存は何もしない(例外を外へ出さない)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS)
    expect(() => saveColumnWidths(resizeColumn(DEFAULT_COLUMN_WIDTHS, 'memo', 300))).not.toThrow()
  })
})
