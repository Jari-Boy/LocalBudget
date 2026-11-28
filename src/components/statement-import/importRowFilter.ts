/**
 * 明細取込画面の一覧の行の絞り込み(計画Issue #258)の純粋関数。
 * 仕訳一覧の絞り込みパネルと同じく、摘要はテキスト(選択欄の検索と同じ正規化)、期間は開始日・終了日、金額は下限・上限(どちらも両端を含む。
 * 取込の金額は符号つき(支出はマイナス)のまま比べるので、マイナスの範囲も指定できる)、相手科目・取引先・プロジェクト・メンバー・精算バッチは複数選択(軸の中はOR)で、
 * 条件どうしはすべてに合う行だけを残す(AND)。選択欄の値(項目・「g:グループID」・「未設定」)は、
 * expandTreeValues で対象のid(グループは配下の項目)に展開して判定に使う。
 * 絞り込みは表示だけの条件で、行の状態・並び・グループ判定には触れない。DB・DOM非依存。
 */
import { matchesSearch } from '../../domain/search/normalizeForSearch'
import { GROUP_VALUE_PREFIX, type TreeSelectCategory, type TreeSelectNode } from '../common/tree-select/treeSelectModel'

/** 「未設定」(その項目が決まっていない行)を表す選択欄の値と、展開後の印 */
export const UNSET_VALUE = 'unset'

/** 展開後の選択: 項目のid、または「未設定」 */
export type IdChoice = number | typeof UNSET_VALUE

export interface ImportRowFilter {
  /** 摘要に含まれる文字。空(空白のみ含む)なら絞らない */
  description: string
  /** 期間の開始日(YYYY-MM-DD)。空なら下限なし */
  dateFrom: string
  /** 期間の終了日(YYYY-MM-DD)。空なら上限なし */
  dateTo: string
  /** 金額(符号つき)の下限。nullなら下限なし */
  amountMin: number | null
  /** 金額(符号つき)の上限。nullなら上限なし */
  amountMax: number | null
  /** 各軸の選択(展開後)。空なら絞らない。軸の中はどれかに合えばよい */
  counterAccount: readonly IdChoice[]
  counterparty: readonly IdChoice[]
  project: readonly IdChoice[]
  /** メンバー。相手科目に既定のメンバーがある行は、その既定のメンバーで判定する */
  member: readonly IdChoice[]
  /** 精算バッチ。「未設定」は未割当の行 */
  batch: readonly IdChoice[]
}

/** 条件が1つも無い状態 */
export const EMPTY_ROW_FILTER: ImportRowFilter = {
  description: '',
  dateFrom: '',
  dateTo: '',
  amountMin: null,
  amountMax: null,
  counterAccount: [],
  counterparty: [],
  project: [],
  member: [],
  batch: [],
}

/** 絞り込みの判定に使う、行の見え方 */
export interface FilterableRow {
  /** 画面に出している摘要 */
  description: string
  /** 日付(YYYY-MM-DD) */
  entryDate: string
  /** 金額(符号つき。支出はマイナス) */
  amount: number
  /** 入力欄の値。重複の行のように入力欄を持たない行はnull */
  inputs: {
    counterAccountId: number | null
    counterpartyId: number | null
    projectId: number | null
    /** 画面に出しているメンバー(科目の既定のメンバー、無ければ行で選んだメンバー) */
    memberId: number | null
    /** 精算バッチ(精算バッチを持てない科目の行はnull) */
    batchId: number | null
  } | null
}

/** 指定されている条件の数(空白だけの摘要は数えない。期間・金額は両端のどちらを指定しても1つ。軸の中で複数選んでも1つ) */
export function activeConditionCount(filter: ImportRowFilter): number {
  return (
    (filter.description.trim() !== '' ? 1 : 0) +
    (filter.dateFrom !== '' || filter.dateTo !== '' ? 1 : 0) +
    (filter.amountMin !== null || filter.amountMax !== null ? 1 : 0) +
    [filter.counterAccount, filter.counterparty, filter.project, filter.member, filter.batch].filter((c) => c.length > 0).length
  )
}

export function isRowFilterActive(filter: ImportRowFilter): boolean {
  return activeConditionCount(filter) > 0
}

function matchesAxis(choices: readonly IdChoice[], value: number | null): boolean {
  return choices.length === 0 || choices.some((c) => (c === UNSET_VALUE ? value === null : c === value))
}

/**
 * 行がすべての条件に合うか。入力欄を持たない行(重複)は、科目・取引先・プロジェクト・メンバー・精算バッチの値を持たないので、
 * それらの条件があるときは(「未設定」でも)合わない。摘要・期間・金額は、どの行も持つので判定する。
 */
export function matchesRowFilter(filter: ImportRowFilter, row: FilterableRow): boolean {
  if (!matchesSearch(row.description, filter.description)) return false
  // ISO形式(YYYY-MM-DD)なので、文字列のまま日付の順に比べられる
  if (filter.dateFrom !== '' && row.entryDate < filter.dateFrom) return false
  if (filter.dateTo !== '' && row.entryDate > filter.dateTo) return false
  if (filter.amountMin !== null && row.amount < filter.amountMin) return false
  if (filter.amountMax !== null && row.amount > filter.amountMax) return false
  const axes = [filter.counterAccount, filter.counterparty, filter.project, filter.member, filter.batch]
  if (row.inputs === null) return axes.every((c) => c.length === 0)
  return (
    matchesAxis(filter.counterAccount, row.inputs.counterAccountId) &&
    matchesAxis(filter.counterparty, row.inputs.counterpartyId) &&
    matchesAxis(filter.project, row.inputs.projectId) &&
    matchesAxis(filter.member, row.inputs.memberId) &&
    matchesAxis(filter.batch, row.inputs.batchId)
  )
}

/** 何にも一致しない印。存在しないグループだけを選んでいても、「絞り込み中」のまま空の結果にするために使う */
const MATCH_NOTHING = -1

function findGroup(nodes: readonly TreeSelectNode[], id: string): TreeSelectNode | undefined {
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    if (node.id === id) return node
    const nested = findGroup(node.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

function collectItemIds(nodes: readonly TreeSelectNode[]): number[] {
  return nodes.flatMap((node) => (node.kind === 'item' ? [Number(node.value)] : collectItemIds(node.children)))
}

/**
 * 選択欄の値(項目の値・「g:グループID」・「未設定」)を、判定に使う選択に展開する。グループは配下(入れ子を含む)の
 * すべての項目のidになり、同じidは重ねない。何も選んでいなければ空(絞り込まない)。
 */
export function expandTreeValues(
  categories: readonly { nodes: readonly TreeSelectNode[] }[],
  values: readonly string[],
): IdChoice[] {
  const result: IdChoice[] = []
  const add = (choice: IdChoice) => {
    if (!result.includes(choice)) result.push(choice)
  }
  for (const value of values) {
    if (value === UNSET_VALUE) {
      add(UNSET_VALUE)
    } else if (value.startsWith(GROUP_VALUE_PREFIX)) {
      const id = value.slice(GROUP_VALUE_PREFIX.length)
      const group = categories.map((c) => findGroup(c.nodes, id)).find((g) => g !== undefined)
      const ids = group !== undefined && group.kind === 'group' ? collectItemIds(group.children) : []
      if (ids.length === 0) add(MATCH_NOTHING)
      else ids.forEach(add)
    } else {
      add(Number(value))
    }
  }
  return result
}

/** 世帯メンバーの選択欄の候補(階層は無いのでフラット)。無効なメンバーは出さない */
export function memberFilterCategories(
  members: readonly { id: number; name: string; isActive: boolean }[],
): TreeSelectCategory[] {
  return [
    {
      key: 'members',
      name: '',
      nodes: members.filter((m) => m.isActive).map((m) => ({ kind: 'item' as const, value: String(m.id), name: m.name, isActive: true })),
    },
  ]
}

/** 精算バッチの選択欄の候補(階層は無いのでフラット) */
export function batchFilterCategories(batches: readonly { id: number; name: string }[]): TreeSelectCategory[] {
  return [
    { key: 'batches', name: '', nodes: batches.map((b) => ({ kind: 'item' as const, value: String(b.id), name: b.name, isActive: true })) },
  ]
}

/** 選択欄の候補の先頭に、「未設定」だけの区分を足す(複数選択の欄には、先頭に固定する特別な項目が無いため、仕訳一覧の「未割当」と同じく項目として並べる) */
export function withUnsetCategory(categories: readonly TreeSelectCategory[], label: string): TreeSelectCategory[] {
  return [{ key: UNSET_VALUE, name: '', nodes: [{ kind: 'item', value: UNSET_VALUE, name: label, isActive: true }] }, ...categories]
}

/** 絞り込みの軸(選択欄で選ぶもの) */
export type FilterAxis = 'counterAccount' | 'counterparty' | 'project' | 'member' | 'batch'

/** 絞り込みパネルの入力そのもの(選択欄の値のまま持つ。「g:グループID」の選択状態も戻せるように、展開前の値を持つ) */
export interface ImportFilterInput {
  description: string
  /** 期間の開始日・終了日(YYYY-MM-DD。空は指定なし) */
  dateFrom: string
  dateTo: string
  /** 金額の下限・上限(入力した文字のまま。空・数字として読めない入力は条件にしない) */
  amountMin: string
  amountMax: string
  values: Record<FilterAxis, readonly string[]>
}

export const EMPTY_FILTER_INPUT: ImportFilterInput = {
  description: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  values: { counterAccount: [], counterparty: [], project: [], member: [], batch: [] },
}

/** 金額の入力を数値にする。空・数字として読めない入力はnull(条件にしない。仕訳一覧と同じ) */
function parseAmount(text: string): number | null {
  if (text.trim() === '') return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : null
}

/** パネルの入力を、判定に使う条件(各軸の選択欄の値をidに展開したもの)にする */
export function resolveFilterInput(
  input: ImportFilterInput,
  categories: Record<FilterAxis, readonly { nodes: readonly TreeSelectNode[] }[]>,
): ImportRowFilter {
  return {
    description: input.description,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    amountMin: parseAmount(input.amountMin),
    amountMax: parseAmount(input.amountMax),
    counterAccount: expandTreeValues(categories.counterAccount, input.values.counterAccount),
    counterparty: expandTreeValues(categories.counterparty, input.values.counterparty),
    project: expandTreeValues(categories.project, input.values.project),
    member: expandTreeValues(categories.member, input.values.member),
    batch: expandTreeValues(categories.batch, input.values.batch),
  }
}

/** 絞り込みで見えなくなった行の選択を外す。残した選択と、外した件数を返す */
export function pruneSelection(
  selected: ReadonlySet<number>,
  isVisible: (index: number) => boolean,
): { kept: Set<number>; removed: number } {
  const kept = new Set([...selected].filter(isVisible))
  return { kept, removed: selected.size - kept.size }
}
