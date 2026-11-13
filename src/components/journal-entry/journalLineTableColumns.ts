/**
 * 明細行単位の表(JournalLineTable、計画Issue #182)の列幅。ユーザーが列の境目をドラッグ(またはキーボード)で
 * 調整でき、調整した幅はlocalStorageに保存して再訪時に復元する。借方と貸方の同じ種類の列(科目どうしなど)は
 * 連動して同じ幅にする(借方・貸方が左右対称のまま保たれ、設定も9列分で済むため)。DB・DOM非依存(保存先を除く)。
 */

/** 列の種類。日付・出どころ・摘要・コメントと、借方・貸方で共通の5種類(取引先・精算バッチは1列) */
export const COLUMN_KEYS = ['date', 'source', 'memo', 'comment', 'account', 'project', 'partner', 'member', 'amount'] as const
export type ColumnKey = (typeof COLUMN_KEYS)[number]
export type ColumnWidths = Record<ColumnKey, number>

/** 借方・貸方それぞれが持つ列(この列の幅は借方と貸方で連動する) */
export const SIDE_COLUMN_KEYS: readonly ColumnKey[] = ['account', 'project', 'partner', 'member', 'amount']
/** 日付〜コメントの列 */
export const LEFT_COLUMN_KEYS: readonly ColumnKey[] = ['date', 'source', 'memo', 'comment']

export const MIN_COLUMN_WIDTH = 48
export const MAX_COLUMN_WIDTH = 600

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  date: 104,
  source: 84,
  memo: 220,
  comment: 170,
  account: 120,
  project: 110,
  partner: 130,
  member: 90,
  amount: 96,
}

const STORAGE_KEY = 'localbudget:journal-line-table-column-widths'

/** 幅を整数にし、下限・上限の範囲に収める。数値でない値(NaN・Infinity)は下限にする */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)))
}

/** 指定した列だけを新しい幅(範囲に収めた値)にした、新しい列幅を返す。元の列幅は変えない */
export function resizeColumn(widths: ColumnWidths, key: ColumnKey, width: number): ColumnWidths {
  return { ...widths, [key]: clampColumnWidth(width) }
}

/** 表全体の幅。借方・貸方の各列は連動して2組あるので、2回数える */
export function totalTableWidth(widths: ColumnWidths): number {
  const sum = (keys: readonly ColumnKey[]) => keys.reduce((total, key) => total + widths[key], 0)
  return sum(LEFT_COLUMN_KEYS) + 2 * sum(SIDE_COLUMN_KEYS)
}

export function isDefaultColumnWidths(widths: ColumnWidths): boolean {
  return COLUMN_KEYS.every((key) => widths[key] === DEFAULT_COLUMN_WIDTHS[key])
}

/**
 * 保存した列幅を読み込む。何も保存されていない・壊れている・localStorageが使えないときは初期の列幅。
 * 一部の列の値が不正なときは、その列だけ初期値にして残りは復元する(範囲外の幅は丸める)。未知の列は無視する。
 */
export function loadColumnWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_COLUMN_WIDTHS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_COLUMN_WIDTHS }
    const saved = parsed as Record<string, unknown>
    const widths = { ...DEFAULT_COLUMN_WIDTHS }
    for (const key of COLUMN_KEYS) {
      const value = saved[key]
      if (typeof value === 'number') widths[key] = clampColumnWidth(value)
    }
    return widths
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS }
  }
}

/** 列幅を保存する。初期の列幅なら保存を消す(初期値に戻したことになる)。保存できなくても例外は出さない */
export function saveColumnWidths(widths: ColumnWidths): void {
  try {
    if (isDefaultColumnWidths(widths)) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // 保存できなくても列幅の調整自体は動く(次回は初期の列幅に戻る)
  }
}
