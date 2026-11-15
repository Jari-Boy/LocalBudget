/** 日付 D の終わり時点の正しい残高(基準点)。CSVの取引後残高、または手で記録した残高 */
export interface BalanceAnchor {
  date: string
  balance: number
}

/** 帳簿の増減。科目の残高が増える向きを正とした符号付き金額(資産は借方、負債は貸方が正) */
export interface LedgerDelta {
  date: string
  delta: number
}

export interface PlannedAdjustment {
  /** capital: 最初の基準点の差額(純資産「初期残高」が相手)。adjustment: 2つ目以降の区間の差額(費用「残高調整」が相手) */
  kind: 'capital' | 'adjustment'
  entryDate: string
  /** ずれた期間の始まり(ひとつ前の基準点の翌日)。元手はnull */
  periodStart: string | null
  periodEnd: string
  /** 科目の残高を増やす向きを正とした符号付き金額(0にはならない) */
  amount: number
}

export interface AnchorRow {
  date: string
  periodStart: string | null
  anchorBalance: number
  /** 調整前の帳簿残高(entry_date <= date の明細の合計に、この行より前に入る元手・調整を足したもの) */
  bookBalance: number
  /** 自動で入る調整額(符号付き、入らなければ0) */
  adjustment: number
  /** 自動調整オフのとき、ずれている額(区間の食い違い。オンなら0) */
  discrepancy: number
  isCapital: boolean
}

export interface BalanceAnchorPlan {
  adjustments: PlannedAdjustment[]
  rows: AnchorRow[]
}

export interface PlanBalanceAnchorAdjustmentsParams {
  anchors: readonly BalanceAnchor[]
  /** 自動調整を含まない帳簿の増減 */
  ledger: readonly LedgerDelta[]
  autoAdjust: boolean
}

/**
 * あるべき自動調整の一覧を計算する純粋関数(計画Issue #205、docs/domain/reconciliation.md 1.5・1.6)。
 * 一番古い基準点の差額は元手(日付は基準点の日と一番古い仕訳の日の早いほう)、2つ目以降は
 * 「帳簿の増減」と「基準点の増減」の食い違いを区間の終わりの日付で調整する。
 * 自動調整オフでも元手は計画し、2つ目以降はdiscrepancyとして返すだけにする。
 */
export function planBalanceAnchorAdjustments(params: PlanBalanceAnchorAdjustmentsParams): BalanceAnchorPlan {
  const anchors = normalizeAnchors(params.anchors)
  const adjustments: PlannedAdjustment[] = []
  const rows: AnchorRow[] = []
  if (anchors.length === 0) return { adjustments, rows }

  const bookAt = (date: string) =>
    params.ledger.filter((line) => line.date <= date).reduce((total, line) => total + line.delta, 0)

  let previous: { anchor: BalanceAnchor; book: number } | null = null
  // これまでに入る元手・調整の合計(調整前の帳簿の表示用)
  let applied = 0
  for (const anchor of anchors) {
    const book = bookAt(anchor.date)
    if (previous === null) {
      const amount = anchor.balance - book
      if (amount !== 0) {
        const earliestLedgerDate = params.ledger.map((line) => line.date).sort()[0]
        const entryDate =
          earliestLedgerDate !== undefined && earliestLedgerDate < anchor.date ? earliestLedgerDate : anchor.date
        adjustments.push({ kind: 'capital', entryDate, periodStart: null, periodEnd: anchor.date, amount })
      }
      rows.push({
        date: anchor.date,
        periodStart: null,
        anchorBalance: anchor.balance,
        bookBalance: book + applied,
        adjustment: amount,
        discrepancy: 0,
        isCapital: true,
      })
    } else {
      const gap = anchor.balance - previous.anchor.balance - (book - previous.book)
      const periodStart = addDays(previous.anchor.date, 1)
      if (gap !== 0 && params.autoAdjust) {
        adjustments.push({
          kind: 'adjustment',
          entryDate: anchor.date,
          periodStart,
          periodEnd: anchor.date,
          amount: gap,
        })
      }
      rows.push({
        date: anchor.date,
        periodStart,
        anchorBalance: anchor.balance,
        bookBalance: book + applied,
        adjustment: params.autoAdjust ? gap : 0,
        discrepancy: params.autoAdjust ? 0 : gap,
        isCapital: false,
      })
    }
    applied += rows[rows.length - 1].adjustment
    previous = { anchor, book }
  }
  return { adjustments, rows }
}

/** 日付順に並べ、同じ日の基準点は後に渡したものを採用する */
function normalizeAnchors(anchors: readonly BalanceAnchor[]): BalanceAnchor[] {
  const byDate = new Map<string, BalanceAnchor>()
  for (const anchor of anchors) byDate.set(anchor.date, anchor)
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
