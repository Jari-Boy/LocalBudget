/**
 * 範囲選択・トグル選択のルール(計画Issue #235 D)。チェックボックスで複数選択できる画面が、Shift+クリックの範囲選択、
 * Ctrl/Cmd+クリックのトグル、Shift+↑↓のキーボード範囲選択を、画面ごとに再実装せず共通に使うための純粋関数。
 * 表示中の行の並び(order)と選択中のid・基点(anchor)だけを受け取り、次の選択と基点を返す。
 * 画面・DOM・DBには依存しない。画面側は、表示中(折りたたみ・絞り込み後)の行のidを並び順に渡す。
 */

/** クリックの修飾キー(MouseEvent・KeyboardEvent の同名のプロパティをそのまま渡せる) */
export interface PickModifiers {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

interface RangeOptions<Id> {
  /** 表示中の行のidの並び(画面に見える順) */
  order: readonly Id[]
  /** 選べない行(例: 重複で選択欄のない行、無効な行)。範囲選択に含めず、押しても切り替えない。既定はすべて選べる */
  isSelectable?: (id: Id) => boolean
  /**
   * 範囲選択がまたがない単位(例: 借方側と貸方側)。基点と押した行の scope が違うと範囲選択にせず、範囲は同じ scope の行だけをたどる。
   * 既定はすべて同じ scope
   */
  scopeOf?: (id: Id) => unknown
}

export interface PickInput<Id> extends RangeOptions<Id> {
  selected: readonly Id[]
  /** 直前に操作した行(範囲の起点)。まだ無ければ null */
  anchor: Id | null
  /** 押した行 */
  id: Id
  modifiers: PickModifiers
}

export interface PickResult<Id> {
  selected: Id[]
  anchor: Id
}

/** order のうち、選べて、scope が scopeValue と同じ行(並びは order のまま) */
function candidates<Id>({ order, isSelectable, scopeOf }: RangeOptions<Id>, scopeValue: unknown): Id[] {
  return order.filter((id) => (isSelectable?.(id) ?? true) && (scopeOf === undefined || scopeOf(id) === scopeValue))
}

/** list の中の2つのidの間(両端を含む)。上下どちらの向きでも、list の並び順で返す */
function between<Id>(list: readonly Id[], a: Id, b: Id): Id[] {
  const i = list.indexOf(a)
  const j = list.indexOf(b)
  return list.slice(Math.min(i, j), Math.max(i, j) + 1)
}

function union<Id>(base: readonly Id[], extra: readonly Id[]): Id[] {
  const result = [...base]
  for (const id of extra) if (!result.includes(id)) result.push(id)
  return result
}

/**
 * 行を押したときの次の選択。Shift+クリックは、基点から押した行までを選択に加える(基点は動かさない。すでに選ばれている行は外さない)。
 * 修飾キーなし・Ctrl/Cmd+クリック(チェックボックスの一覧ではどちらも「その行を切り替える」)は、その行だけを切り替えて基点にする。
 * Shift でも、基点が無い・表示中に無い・scope が違うときは、その行だけを切り替えて基点にする。
 */
export function pickItem<Id>(input: PickInput<Id>): PickResult<Id> {
  const { selected, anchor, id, modifiers, isSelectable, scopeOf } = input
  if (!(isSelectable?.(id) ?? true)) return { selected: [...selected], anchor: anchor ?? id }

  if (modifiers.shiftKey && anchor !== null && (scopeOf === undefined || scopeOf(anchor) === scopeOf(id))) {
    const list = candidates(input, scopeOf?.(id))
    if (list.includes(anchor) && list.includes(id)) {
      return { selected: union(selected, between(list, anchor, id)), anchor }
    }
  }

  return { selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], anchor: id }
}

export interface ArrowInput<Id> extends RangeOptions<Id> {
  selected: readonly Id[]
  anchor: Id | null
  /** 今フォーカスのある行 */
  focusedId: Id
  direction: 'up' | 'down'
}

export interface ArrowResult<Id> {
  selected: Id[]
  anchor: Id | null
  /** 次にフォーカスを移す行。フォーカス中の行が表示中に無いときは null(何も変えない) */
  focusId: Id | null
}

/**
 * Shift+↑↓: 基点から「動かした先」までの範囲を選択にする。広げる向きなら範囲が広がり、戻す向きなら縮んで基点から外れた行の選択が外れる
 * (範囲の外で、別の方法で選んでいた行は変えない)。基点が無ければ、今の行を基点にする。選べない行と別の scope の行は飛ばし、
 * 端ではそれ以上動かない。
 */
export function extendSelectionByArrow<Id>(input: ArrowInput<Id>): ArrowResult<Id> {
  const { selected, anchor, focusedId, direction, scopeOf } = input
  const list = candidates(input, scopeOf?.(focusedId))
  const current = list.indexOf(focusedId)
  if (current === -1) return { selected: [...selected], anchor, focusId: null }

  const base = anchor !== null && list.includes(anchor) ? anchor : focusedId
  const target = list[Math.max(0, Math.min(list.length - 1, current + (direction === 'down' ? 1 : -1)))]
  const oldRange = between(list, base, focusedId)
  const newRange = between(list, base, target)
  const kept = selected.filter((id) => !oldRange.includes(id) || newRange.includes(id))
  return { selected: union(kept, newRange), anchor: base, focusId: target }
}
