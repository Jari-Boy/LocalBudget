import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import {
  listSplittableLineEntries,
  signedLineAmount,
  type SplittableLine,
  type SplittableLineEntry,
} from '../../domain/expense-splitting/listSplittableLineEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../infrastructure/i18n/formatDate'
import { JournalFilterPanel } from '../common/journal-filter/JournalFilterPanel'
import { ListLoadMore } from '../common/list-paging/ListLoadMore'
import { nextDisplayLimit, resolveShownCount } from '../common/list-paging/listPaging'
import { useElementHeight } from '../common/sticky/useElementHeight'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { EntryDetailDialog } from './EntryDetailDialog'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import {
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from '../expense-splitting/expenseSplittingFormParticipant'
import { planLineExpenseSplit, type SelectedSplitLine } from '../expense-splitting/planLineExpenseSplit'
import { runInHistoryGroup } from '../../infrastructure/history/historyGroupRunner'
import { submitExpenseSplit, type SubmitExpenseSplitError } from '../expense-splitting/submitExpenseSplit'
import { BatchSelect } from '../master/BatchSelect'
import { useEscapeToClear } from '../common/range-selection/useEscapeToClear'
import { useRangeSelection } from '../common/range-selection/useRangeSelection'
import type { SplitSettleData, SplitSettleDerived, SplitSettleRepositories } from './splitSettleData'
import { SPLIT_LIST_PAGE_SIZE } from './splitListPaging'
import { buildPartnerCategories, parsePartnerValue, splitEvenly, toPartnerValue } from './splitSettleModel'
import { buildSplitLineTableRows, selectableLineIdsBySide } from './splitLineTableModel'
import { buildSplitPreviews } from './splitPreviewModel'
import { StickyHeaderTable } from '../common/sticky/StickyHeaderTable'
import { SortableHeaderCell } from '../common/table-sort/SortableHeaderCell'
import { compareJournalSort, cycleJournalSort, type JournalSort, type JournalSortKey, type JournalSortLookup } from '../journal-entry/journalEntrySort'
import { JournalLineTableResizeHandle } from '../journal-entry/JournalLineTableResizeHandle'
import { useJournalLineTableColumns } from '../journal-entry/useJournalLineTableColumns'
import type { ColumnKey } from '../journal-entry/journalLineTableColumns'
import '../journal-entry/JournalLineTable.css'
import './SplitSettleScreen.css'

export interface SplitTabProps {
  data: SplitSettleData
  derived: SplitSettleDerived
  repositories: SplitSettleRepositories
  /** 割勘仕訳の取引日(YYYY-MM-DD) */
  today: string
  /** 書き込みのあとにデータを読み直す */
  onChanged: () => Promise<void>
  /** 最初から選んだ状態にする仕訳(仕訳画面の「この仕訳を割勘」から来たとき)。その仕訳の選べる行をすべて選ぶ */
  initialCheckedEntryIds?: readonly number[]
  /** 絞り込み条件。開閉ボタンがタブの行にあるため、親が持つ(計画Issue #266) */
  filter: JournalEntryFilter
  onFilterChange: (filter: JournalEntryFilter) => void
  /** 絞り込み欄を開いているか。初期は閉 */
  filterOpen: boolean
}

const ERROR_TEXT: Record<SubmitExpenseSplitError, string> = {
  expenseAccountNotFound: '費用・収益の行を選んでください',
  requiredFieldMissing: '未収金(精算バッチ)の科目が見つかりません',
  advanceLiabilityAccountRequired: '未払金の科目が見つかりません',
  counterpartyTargetRequired: '分担相手を選んでください',
  noRecipient: '相手の負担額が0円です。割合や金額を確認してください',
  ratioTotalMismatch: '負担割合の合計を100%にしてください',
  amountTotalMismatch: '負担額の合計を、選んだ行の合計に合わせてください',
  memoRequired: '摘要を入力してください',
  amountNetZero: '選んだ行の借方と貸方が差し引きで0円のため、金額を指定できません。割合か均等で分けてください',
}

/** 割勘タブのバッチの先頭に固定する「新しいバッチを作成」(記録するときにバッチを作る既定の選択状態)。参照を安定させるため定数にする */
const NEW_BATCH_OPTIONS = [{ value: 'new', label: '新しいバッチを作成' }]

const MODE_LABEL: Record<ExpenseSplittingAllocationMode, string> = {
  ratio: '割合で分ける',
  equal: '均等に分ける',
  amount: '金額を指定する',
}

const SIDE_LABEL: Record<JournalLineSide, string> = { debit: '借方', credit: '貸方' }

/** 'YYYY-MM-DD' の日付を表示用の Date にする(仕訳一覧の明細行単位の表と同じ表記にするため、formatDate に通す) */
function toDate(entryDate: string): Date {
  const [year, month, day] = entryDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 候補の表の列幅の保存先。仕訳一覧の明細行単位の表とは別に持つ(同じつまみ・同じ保存の仕組みを使う、計画Issue #271) */
const COLUMN_WIDTHS_STORAGE_KEY = 'localbudget:split-line-table-column-widths'
/** 割勘仕訳のプレビューの表の列幅(%)。借方・貸方とも「科目・世帯メンバー・取引先/精算バッチ・金額」。分担相手ごとの表で同じにして縦線をそろえる */
const PREVIEW_COLUMN_PERCENTS = [14, 11, 14, 11, 14, 11, 14, 11]
/** 固定した絞り込み欄とタブの行との隙間(px)。SplitSettleScreen.css の .split-settle__filter の top と同じ値 */
const FILTER_STICKY_GAP = 8
/** 行のチェックの列の幅(px)。固定で、列幅の調整の対象外 */
const CHECK_COLUMN_WIDTH = 32

/**
 * 摘要の入力例(入力欄のplaceholder)。1つの仕訳の行だけを選んでいるときは「元の摘要+の割勘」。複数の仕訳の行を選んでいるときは、
 * 入力例は出さない(空のまま入力させる)。摘要は必須で、空のまま記録はできない。新しい精算バッチを作るときの名前にもなる
 */
function memoExample(chosen: readonly SelectedSplitLine[]): string {
  const entryIds = new Set(chosen.map((c) => c.entry.id))
  if (entryIds.size !== 1) return ''
  const memo = chosen[0].entry.memo
  return memo === null || memo === '' ? '割勘' : `${memo}の割勘`
}

/** 候補の中の、指定した仕訳の選べる行をすべて選んだ状態のid */
function selectableLineIdsOfEntries(items: readonly SplittableLineEntry[], entryIds: readonly number[]): number[] {
  const wanted = new Set(entryIds)
  return items
    .filter((i) => wanted.has(i.entry.id))
    .flatMap((i) => i.lines.filter((l) => l.selectable).map((l) => l.line.id))
}

/**
 * 割勘タブ(計画Issue #153、承認済みモックアップ。計画Issue #271で、仕訳単位の候補を仕訳の明細行単位にした)。
 * 絞り込み欄はタブの行のボタンで開閉し(初期は閉、計画Issue #266)、割勘できる行だけを候補に出す。候補の表は
 * 仕訳一覧の明細行単位の表と同じく、借方の行を左・貸方の行を右に並べ、各側の行にチェックを付ける。選べるのは費用・収益の行
 * (借方・貸方とも)で、それ以外の行(支払元の資産の行など)はチェックできない。割勘済みの行は表示しない。
 * 行を選び、分担相手(世帯メンバーと取引先をグループつきで選ぶ)と負担の割合で割勘を記録する。借方の行と貸方の行(返金・
 * 値引き・収益)を一緒に選んだときは、貸方を差し引いた純額に対して按分する。絞り込みで隠れた行も、チェック済みなら合計に含める。
 * 按分は割合のほか、均等・金額指定を選べる(金額指定は、純額が0円でないとき)。精算バッチは新規作成(既定)か既存から選ぶ。
 * 割勘仕訳の摘要は入力でき、空のときは既定の摘要を使う(新しい精算バッチを作るときは、その摘要がバッチ名になる)。
 * 記録する前に、作られる割勘仕訳のプレビュー(読み取り専用)を出す。
 * 分担の設定は、候補の表の上に固定するバーにある(計画Issue #301)。1段目に選んだ行の数・合計・注記とエラー・選択の解除・記録、
 * 2段目に按分の方法・分担相手・摘要・精算バッチを置き、左端の矢印で2段目をたためる(最初は開いている。たたんだ間は要約を出し、
 * 摘要・分担相手のエラーで記録できなかったときは自動で開く)。バーの高さは測って、表の見出しの固定位置に足す。
 * 候補は仕訳150件ずつ「さらにN件表示」で出し、チェック済みの行が150件の外にあるときは、その行が見える件数まで広げる
 * (合計に含まれる行が見えなくならないため、計画Issue #268)。割勘履歴は履歴タブ(SplitHistoryTab)にある。
 */
export function SplitTab({
  data,
  derived,
  repositories,
  today,
  onChanged,
  initialCheckedEntryIds = [],
  filter,
  onFilterChange,
  filterOpen,
}: SplitTabProps) {
  /** 絞り込み欄(開いているときだけある)の要素と高さ。右のパネルの追従位置に足す(計画Issue #266) */
  const [filterElement, setFilterElement] = useState<HTMLDivElement | null>(null)
  const filterHeight = useElementHeight(filterElement)
  /**
   * 上部に固定する分担のバーの要素と高さ(計画Issue #301)。バーの高さは、分担相手の行・エラー・たたみ方で変わるため測る。
   * 表の見出しの複製の固定位置(--sticky-bulk-h)に足し、バーの下に出す
   */
  const [barElement, setBarElement] = useState<HTMLDivElement | null>(null)
  const barHeight = useElementHeight(barElement)
  /** 分担のバーの2段目(入力欄)をたたんでいるか。最初は開いている */
  const [barCollapsed, setBarCollapsed] = useState(false)
  const columns = useJournalLineTableColumns(COLUMN_WIDTHS_STORAGE_KEY)
  const { widths, widthsRef } = columns
  /** 候補の表のカード(画面に出ている表の幅を測るため) */
  const lineCardRef = useRef<HTMLElement>(null)

  const relatedIds = useMemo(() => buildRelatedEntryIdsByEntryId(data.memberships), [data.memberships])
  const candidates = useMemo(
    () => listSplittableLineEntries(data.entries, data.accounts, relatedIds, data.sourceLinks),
    [data.entries, data.accounts, relatedIds, data.sourceLinks],
  )

  const [checkedIds, setCheckedIds] = useState<ReadonlySet<number>>(
    () => new Set(selectableLineIdsOfEntries(candidates, initialCheckedEntryIds)),
  )
  const nextKey = useRef(3)
  // 負担する人。最初から2行で、割合は50%ずつ。1行目の世帯メンバーは、選んだ行の立替者のうち最も行数の多い人を自動で入れる
  const [partnerInputs, setPartners] = useState<ExpenseSplittingParticipantRow[]>([
    { key: 1, kind: 'householdMember', targetId: null, ratioInput: '50', amountInput: '' },
    { key: 2, kind: 'householdMember', targetId: null, ratioInput: '50', amountInput: '' },
  ])
  /** 1行目を自分で選んだら、以後は行の選択を変えても自動では上書きしない */
  const [firstRowTouched, setFirstRowTouched] = useState(false)
  /** 割合・金額を自分で入力したら、以後は均等な初期値を入れ直さない(行を増減したら、また均等に入れ直す) */
  const [ratiosTouched, setRatiosTouched] = useState(false)
  const [amountsTouched, setAmountsTouched] = useState(false)
  const [mode, setMode] = useState<ExpenseSplittingAllocationMode>('ratio')
  const [batchId, setBatchId] = useState<number | 'new'>('new')
  const [memoInput, setMemoInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  /** エラーを出す場所。摘要・分担相手の欄の近くか、それ以外は「割勘を記録」ボタンの隣 */
  const [errorTarget, setErrorTarget] = useState<'memo' | 'partner' | 'commit'>('commit')
  const [createForRowKey, setCreateForRowKey] = useState<number | null>(null)
  /** 「さらに表示」で増やした表示件数の上限。絞り込み条件を変えると先頭の1ページ分に戻す */
  const [displayLimit, setDisplayLimit] = useState<number>(SPLIT_LIST_PAGE_SIZE.candidate)
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null)
  /**
   * 候補の表の、列見出しでの並び替え(計画Issue #302)。見出しを押した時点に描画している候補(1ページ分)の値で並びを決め、
   * 以後は動かさない(チェックは行のid基準なので並べても保たれる)。絞り込み条件を変えると解除する
   */
  const [lineSort, setLineSort] = useState<JournalSort | null>(null)

  const shown = useMemo(() => {
    const visibleIds = new Set(
      filterJournalEntries(
        candidates.map((c) => c.entry),
        data.accounts,
        filter,
        derived.filterContext,
      ).map((e) => e.id),
    )
    return candidates
      .filter((c) => visibleIds.has(c.entry.id))
      .sort((a, b) => b.entry.entryDate.localeCompare(a.entry.entryDate) || b.entry.id - a.entry.id)
  }, [candidates, data.accounts, filter, derived.filterContext])
  /** 表に出す仕訳の件数。上限までだが、チェック済みの行(絞り込みで隠れたものは数えない)が範囲の外にあるときは、いちばん後ろの行が見えるまで広げる */
  const lastCheckedIndex = shown.reduce(
    (last, item, index) => (item.lines.some((l) => checkedIds.has(l.line.id)) ? index : last),
    -1,
  )
  const shownCount = resolveShownCount({
    total: shown.length,
    limit: displayLimit,
    pageSize: SPLIT_LIST_PAGE_SIZE.candidate,
    selectedIndex: lastCheckedIndex,
  })
  /** 描画する候補。列見出しを押しているときは、描画中の1ページ分の中だけを並べ替える(全件は並べない、計画Issue #302) */
  const visible = useMemo(() => {
    const page = shown.slice(0, shownCount)
    return lineSort === null ? page : page.sort((a, b) => compareJournalSort(lineSort, a.entry.id, b.entry.id))
  }, [shown, shownCount, lineSort])
  const rows = useMemo(() => buildSplitLineTableRows(visible), [visible])

  /** 選んだ行(絞り込みで隠れた行も含む)。候補の並びのまま */
  const chosen = useMemo<SelectedSplitLine[]>(
    () =>
      candidates.flatMap(({ entry, lines }) =>
        lines.filter((l) => l.selectable && checkedIds.has(l.line.id)).map((l) => ({ entry, line: l.line })),
      ),
    [candidates, checkedIds],
  )
  const net = chosen.reduce((sum, c) => sum + signedLineAmount(c.line), 0)
  const debitTotal = chosen.filter((c) => c.line.side === 'debit').reduce((sum, c) => sum + c.line.amount, 0)
  const creditTotal = chosen.filter((c) => c.line.side === 'credit').reduce((sum, c) => sum + c.line.amount, 0)
  /** 選んだ行の立替者(元の仕訳の起票者)のうち、行数がいちばん多い世帯メンバー(同数ならidが小さい人)。行を選んでいなければnull */
  const mostFrequentPayerId = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of chosen) counts.set(c.entry.householdMemberId, (counts.get(c.entry.householdMemberId) ?? 0) + 1)
    let best: number | null = null
    for (const [id, count] of [...counts].sort((a, b) => a[0] - b[0])) {
      if (best === null || count > (counts.get(best) ?? 0)) best = id
    }
    return best
  }, [chosen])
  /**
   * 画面の入力に、自動の初期値を反映した負担する人。1行目の世帯メンバーは選んだ行の立替者で最も多い人、割合は人数で均等
   * (100%を分ける)、金額は選んだ行の合計(差し引きの絶対値)を人数で均等に分けた額。自分で入力したら、その入力を使う
   */
  const partners = useMemo<ExpenseSplittingParticipantRow[]>(() => {
    const evenRatios = splitEvenly(100, partnerInputs.length)
    const evenAmounts = splitEvenly(Math.abs(net), partnerInputs.length)
    return partnerInputs.map((p, i) => {
      const withDefaults = {
        ...p,
        ratioInput: ratiosTouched ? p.ratioInput : String(evenRatios[i]),
        amountInput: amountsTouched ? p.amountInput : String(evenAmounts[i]),
      }
      return p.key === 1 && !firstRowTouched && mostFrequentPayerId !== null
        ? { ...withDefaults, kind: 'householdMember' as const, targetId: mostFrequentPayerId }
        : withDefaults
    })
  }, [partnerInputs, firstRowTouched, mostFrequentPayerId, ratiosTouched, amountsTouched, net])
  const amountModeBlocked = chosen.length > 0 && net === 0

  /** この行で選べる分担相手。他の行で選んだ世帯メンバー・取引先は除く(同じ人を二重に選べない)。この行の選択は残す */
  const categoriesFor = (row: ExpenseSplittingParticipantRow) => {
    const others = partners.filter((p) => p.key !== row.key && p.targetId !== null)
    return buildPartnerCategories(
      data.members,
      derived.counterpartyCategories,
      new Set(others.filter((p) => p.kind === 'householdMember').map((p) => p.targetId as number)),
      new Set(others.filter((p) => p.kind === 'counterparty').map((p) => p.targetId as number)),
    )
  }

  // 人ごとの負担額(送信時と同じ計算)。計算できないとき(合計が合わないなど)は空にする
  const plan = planLineExpenseSplit({ selectedLines: chosen, accounts: data.accounts, participants: partners, allocationMode: mode })
  const burdenOf = (key: number): number | null => (plan.ok ? (plan.burdens.get(key) ?? 0) : null)
  const allSelected = partners.every((p) => p.targetId !== null)

  /** 入力した負担の合計(行を選んでいない・相手を選んでいない行も含む)。割合は100%、金額は選んだ行の純額に合うことを求める */
  const ratioSum = partners.reduce((sum, p) => sum + (Number(p.ratioInput) || 0), 0)
  const amountSum = partners.reduce((sum, p) => sum + (Number(p.amountInput) || 0), 0)
  const totalsMismatch =
    chosen.length > 0 &&
    ((mode === 'ratio' && Math.abs(ratioSum - 100) > 1e-9) || (mode === 'amount' && net !== 0 && amountSum !== Math.abs(net)))
  /** 負担の合計以外の、記録できない理由(選択・入力を直すと消える)。相手を選び終えるまでは出さない */
  const planError =
    chosen.length > 0 && allSelected && !plan.ok && plan.error !== 'ratioTotalMismatch' && plan.error !== 'amountTotalMismatch'
      ? plan.error
      : null

  const batchLabel =
    batchId === 'new' ? memoInput.trim() : (data.batches.find((b) => b.id === batchId)?.name ?? '')
  const previews = useMemo(
    () =>
      buildSplitPreviews({
        selectedLines: chosen,
        accounts: data.accounts,
        participants: partners,
        allocationMode: mode,
        today,
        batchLabel,
        accountName: (id) => data.accounts.find((a) => a.id === id)?.name ?? '',
        memberName: (id) => data.members.find((m) => m.id === id)?.name ?? '',
        counterpartyName: (id) => data.counterparties.find((c) => c.id === id)?.name ?? '',
      }),
    [chosen, data.accounts, data.members, data.counterparties, partners, mode, today, batchLabel],
  )

  const patchPartner = (key: number, changes: Partial<ExpenseSplittingParticipantRow>) => {
    if (key === 1 && ('targetId' in changes || 'kind' in changes)) setFirstRowTouched(true)
    // 初めて割合・金額を入力するときは、表示中の均等な初期値を、他の行の入力値として確定させる
    const freezeRatios = 'ratioInput' in changes && !ratiosTouched
    const freezeAmounts = 'amountInput' in changes && !amountsTouched
    if ('ratioInput' in changes) setRatiosTouched(true)
    if ('amountInput' in changes) setAmountsTouched(true)
    setPartners((prev) =>
      prev.map((p) => {
        const shown = partners.find((x) => x.key === p.key)
        let next = p
        if (shown !== undefined && freezeRatios) next = { ...next, ratioInput: shown.ratioInput }
        if (shown !== undefined && freezeAmounts) next = { ...next, amountInput: shown.amountInput }
        return p.key === key ? { ...next, ...changes } : next
      }),
    )
    setFlash('')
    setError('')
  }

  // 行のチェックの Shift+クリック(範囲選択)・Ctrl/Cmd+クリック(トグル)・Shift+↑↓。範囲は借方側・貸方側のそれぞれの中だけ
  const selectableLines = visible.flatMap((item) => item.lines.filter((l) => l.selectable))
  const sideByLineId = new Map(selectableLines.map((l) => [l.line.id, l.line.side]))
  const range = useRangeSelection<number>({
    order: selectableLines.map((l) => l.line.id),
    selected: [...checkedIds],
    onChange: (next) => {
      setCheckedIds(new Set(next))
      setFlash('')
      setError('')
    },
    scopeOf: (id) => sideByLineId.get(id),
  })
  /** 選んだ行をすべて外す(バーの「選択を解除」・Esc) */
  const clearSelection = () => {
    setCheckedIds(new Set())
    setFlash('')
    setError('')
  }
  // Esc で行のチェックをすべて外す
  useEscapeToClear(checkedIds.size > 0 ? clearSelection : null)

  const changeFilter = (next: JournalEntryFilter) => {
    setDisplayLimit(SPLIT_LIST_PAGE_SIZE.candidate)
    setLineSort(null)
    onFilterChange(next)
  }

  const changeMode = (next: ExpenseSplittingAllocationMode) => {
    setMode(next)
    setFlash('')
    setError('')
  }

  /** 見出しのチェック: その側の表示中の選べる行をすべて選ぶ(すべて選択済みなら外す) */
  const toggleSide = (side: JournalLineSide) => {
    const ids = selectableLineIdsBySide(visible, side)
    const allChecked = ids.length > 0 && ids.every((id) => checkedIds.has(id))
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (allChecked) next.delete(id)
        else next.add(id)
      }
      return next
    })
    setFlash('')
    setError('')
  }

  const commit = async () => {
    if (submitting || chosen.length === 0) return
    // 摘要・分担相手のエラーは入力欄の近くに出すので、たたんでいたら開いて見せる
    if (partners.some((p) => p.targetId === null)) {
      setBarCollapsed(false)
      setErrorTarget('partner')
      setError(ERROR_TEXT.counterpartyTargetRequired)
      return
    }
    if (memoInput.trim() === '') {
      setBarCollapsed(false)
      setErrorTarget('memo')
      setError(ERROR_TEXT.memoRequired)
      return
    }
    setSubmitting(true)
    setError('')
    setFlash('')
    try {
      const result = await runInHistoryGroup(repositories.history, 'expenseSplit.submit', () =>
        submitExpenseSplit({
          selectedLines: chosen,
          accounts: data.accounts,
          settlementBatches: data.batches,
          participants: partners,
          allocationMode: mode,
          memo: memoInput.trim(),
          settlementBatchId: batchId,
          today,
          repositories,
        }),
      )
      if (!result.ok) {
        if (result.error === 'memoRequired' || result.error === 'counterpartyTargetRequired') setBarCollapsed(false)
        setErrorTarget(result.error === 'memoRequired' ? 'memo' : result.error === 'counterpartyTargetRequired' ? 'partner' : 'commit')
        setError(ERROR_TEXT[result.error])
        return
      }
      setCheckedIds(new Set())
      setBatchId('new')
      setMemoInput('')
      await onChanged()
      setFlash('割勘を記録しました')
    } catch {
      setErrorTarget('commit')
      setError('割勘を記録できませんでした')
    } finally {
      setSubmitting(false)
    }
  }

  const detailEntry = data.entries.find((e) => e.id === detailEntryId)
  const accountName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? '(不明な科目)'
  const memberName = (id: number) => data.members.find((m) => m.id === id)?.name ?? ''
  const partnerOf = (line: SplittableLine['line']) => {
    if (line.counterpartyId !== null) return data.counterparties.find((c) => c.id === line.counterpartyId)?.name ?? ''
    if (line.settlementBatchId !== null) return data.batches.find((b) => b.id === line.settlementBatchId)?.name ?? ''
    return ''
  }

  /** 並び替えの値に使う名前(表に出る名前と同じ) */
  const sortLookup: JournalSortLookup = {
    accountName: (id) => data.accounts.find((a) => a.id === id)?.name ?? '',
    projectName: () => '',
    counterpartyName: (id) => data.counterparties.find((c) => c.id === id)?.name ?? '',
    batchName: (id) => data.batches.find((b) => b.id === id)?.name ?? '',
    memberName: memberName,
  }
  /** 並び替えできる列の見出し(列幅のつまみつき)。押すと、描画中の候補(1ページ分)の値で 昇順→降順→解除 を切り替える */
  const sortHead = (key: JournalSortKey, label: string, resize: ReactNode, className?: string) => (
    <SortableHeaderCell
      key={key}
      label={label}
      className={className}
      direction={lineSort?.key === key ? lineSort.direction : null}
      onSort={() =>
        setLineSort((prev) =>
          cycleJournalSort(
            prev,
            key,
            visible.map((v) => v.entry),
            sortLookup,
          ),
        )
      }
    >
      {resize}
    </SortableHeaderCell>
  )

  /** たたんだバーの要約に出す、負担する人1人分の表記(割合なら「妻 50%」、金額指定なら「妻 ¥600」、均等なら名前だけ) */
  const recapOfPartner = (row: ExpenseSplittingParticipantRow) => {
    const name = partnerName(row)
    if (mode === 'ratio') return `${name} ${row.ratioInput === '' ? 0 : row.ratioInput}%`
    if (mode === 'amount') return `${name} ${formatCurrency(Number(row.amountInput) || 0, 'JPY')}`
    return name
  }

  const partnerName = (row: ExpenseSplittingParticipantRow) => {
    if (row.targetId === null) return '未選択'
    if (row.kind === 'householdMember') return data.members.find((m) => m.id === row.targetId)?.name ?? '未選択'
    return data.counterparties.find((c) => c.id === row.targetId)?.name ?? '未選択'
  }

  /** 借方・貸方の側ごとのセル(チェック・科目・取引先/精算バッチ・世帯メンバー・金額)。選べない行は無効なチェックと理由 */
  const sideCells = (item: SplittableLine | null, side: JournalLineSide) => {
    const start = side === 'debit' ? 'journal-line-table__debit-start' : 'journal-line-table__credit-start'
    if (item === null) {
      return [
        <td key="check" className={`journal-line-table__cell journal-line-table__cell--check ${start}`} />,
        <td key="account" className="journal-line-table__cell" />,
        <td key="partner" className="journal-line-table__cell" />,
        <td key="member" className="journal-line-table__cell" />,
        <td key="amount" className="journal-line-table__cell journal-line-table__cell--amount" />,
      ]
    }
    const { line, selectable, reason } = item
    const selected = checkedIds.has(line.id)
    const selectedClass = selected ? ' journal-line-table__cell--bulk-selected' : ''
    const dim = selectable ? '' : ' split-settle__cell--disabled'
    return [
      <td key="check" className={`journal-line-table__cell journal-line-table__cell--check ${start}${selectedClass}${dim}`}>
        <input
          type="checkbox"
          className="journal-line-table__checkbox"
          aria-label={`${SIDE_LABEL[side]}の${accountName(line.accountId)}の行を選択`}
          checked={selected}
          disabled={!selectable}
          title={reason === 'not_profit_loss_account' ? '費用・収益の行ではないため選べません' : undefined}
          {...(selectable ? range.checkboxProps(line.id) : {})}
        />
      </td>,
      <td key="account" className={`journal-line-table__cell journal-line-table__cell--account${selectedClass}${dim}`}>
        {accountName(line.accountId)}
      </td>,
      <td key="partner" className={`journal-line-table__cell${selectedClass}${dim}`}>
        {partnerOf(line)}
      </td>,
      <td key="member" className={`journal-line-table__cell${selectedClass}${dim}`}>
        {memberName(line.householdMemberId)}
      </td>,
      <td key="amount" className={`journal-line-table__cell journal-line-table__cell--amount${selectedClass}${dim}`}>
        {formatCurrency(line.amount, 'JPY')}
      </td>,
    ]
  }

  const sideHeadCheck = (side: JournalLineSide) => {
    const ids = selectableLineIdsBySide(visible, side)
    const checkedCount = ids.filter((id) => checkedIds.has(id)).length
    return (
      <input
        type="checkbox"
        className="journal-line-table__checkbox"
        aria-label={`${SIDE_LABEL[side]}の行をすべて選択`}
        checked={ids.length > 0 && checkedCount === ids.length}
        disabled={ids.length === 0}
        ref={(element) => {
          if (element) element.indeterminate = checkedCount > 0 && checkedCount < ids.length
        }}
        onChange={() => toggleSide(side)}
      />
    )
  }

  /** 画面に出ている表の幅 ÷ 列幅の合計(枠が広くて余った幅が各列に配られているとき、1より大きくなる) */
  const getScale = () => {
    const shown = lineCardRef.current?.querySelector<HTMLTableElement>('table.split-settle__line-table')?.offsetWidth ?? 0
    const w = widthsRef.current
    const total = w.date + w.memo + w.comment + 2 * (CHECK_COLUMN_WIDTH + w.account + w.partner + w.member + w.amount)
    return shown > 0 ? shown / total : 1
  }

  /**
   * 見出しの右端の列幅のつまみ。借方と貸方の同じ種類の列は連動する。表の幅は列幅の合計を最小幅にするだけなので、
   * 枠が広いと余った幅が各列に配られる。ドラッグ量は、画面に出ている表の幅 ÷ 列幅の合計で割って列幅に直す
   */
  const resizeHandle = (key: ColumnKey, label: string) => (
    <JournalLineTableResizeHandle
      label={`${label}の列幅`}
      value={widths[key]}
      getScale={getScale}
      onResize={(width) => columns.resizeTo(key, width)}
      onCommit={columns.commit}
      onReset={() => columns.resetColumn(key)}
    />
  )
  const tableWidth =
    widths.date + widths.memo + widths.comment + 2 * (CHECK_COLUMN_WIDTH + widths.account + widths.partner + widths.member + widths.amount)

  return (
    <>
      {filterOpen && (
        <div className="split-settle__filter" id="split-settle-filter" ref={setFilterElement}>
          <JournalFilterPanel
            filter={filter}
            onChange={changeFilter}
            options={derived.filterOptions}
            resultCount={shown.length}
          />
        </div>
      )}

      {/* 候補の表(全幅)・分担・割勘仕訳のプレビューを縦に並べる。固定したタブの行と絞り込み欄の下に追従する高さを --sticky-head-extra で渡す(計画Issue #266) */}
      <div
        className="split-settle__stack"
        style={
          {
            // 絞り込み欄の高さ。開いているときは、タブの行との隙間(8px、.split-settle__filter の top)も足す
            '--sticky-head-extra': `${filterHeight > 0 ? filterHeight + FILTER_STICKY_GAP : 0}px`,
            '--sticky-bulk-h': `${barHeight}px`,
          } as CSSProperties
        }
      >
        {/* 分担のバー(計画Issue #301)。候補の表の上に、タブの行・絞り込み欄の下へ固定する。1段目は概要と記録、2段目は分担の入力(矢印でたためる) */}
        <div className="split-settle__bar" ref={setBarElement}>
          <section aria-label="分担" className="split-settle__card split-settle__bar-card">
            <div className="split-settle__bar-top">
              <button
                type="button"
                className="split-settle__fold"
                aria-expanded={!barCollapsed}
                aria-controls="split-bar-fields"
                aria-label={barCollapsed ? '分担の設定を開く' : '分担の設定をたたむ'}
                title={barCollapsed ? '分担の設定を開く' : '分担の設定をたたむ'}
                onClick={() => setBarCollapsed((v) => !v)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 6l4.5 4.5L12.5 6" />
                </svg>
              </button>
              <div className="split-settle__bar-summary">
            <div className="split-settle__totals">
              <div className="split-settle__line">
                <span>選んだ行</span>
                <span className="split-settle__num">{`${chosen.length}行`}</span>
              </div>
              {creditTotal > 0 && (
                <>
                  <div className="split-settle__line split-settle__line--sub">
                    <span>借方の合計</span>
                    <span className="split-settle__num">{formatCurrency(debitTotal, 'JPY')}</span>
                  </div>
                  <div className="split-settle__line split-settle__line--sub">
                    <span>貸方の合計(差し引き)</span>
                    <span className="split-settle__num">{formatCurrency(-creditTotal, 'JPY')}</span>
                  </div>
                </>
              )}
              <div className="split-settle__line">
                <span>選択した合計</span>
                <span className="split-settle__num">{formatCurrency(net, 'JPY')}</span>
              </div>
            </div>

                {/* たたんでいる間は、2段目の入力の中身を1行の要約で出す(開かなくても、何を設定したか分かる) */}
                {barCollapsed && (
                  <span className="split-settle__bar-recap">
                    {`${MODE_LABEL[mode]}: ${partners.map((p) => recapOfPartner(p)).join('・')}`}
                  </span>
                )}
                {barCollapsed && (
                  <span className={`split-settle__bar-recap${memoInput.trim() === '' ? ' split-settle__bar-recap--warn' : ''}`}>
                    {memoInput.trim() === '' ? '摘要が未入力です' : `摘要「${memoInput.trim()}」`}
                  </span>
                )}
                {totalsMismatch && (
                  <p role="status" className="split-settle__note split-settle__note--warn">
                    {mode === 'ratio'
                      ? `負担割合の合計を100%にしてください(いま${ratioSum}%)。`
                      : `負担額の合計を${formatCurrency(Math.abs(net), 'JPY')}にしてください(いま${formatCurrency(amountSum, 'JPY')})。`}
                  </p>
                )}
                {planError !== null && (
                  <p role="status" className="split-settle__note">
                    {ERROR_TEXT[planError]}
                  </p>
                )}
                {error !== '' && errorTarget === 'commit' && (
                  <p role="alert" className="split-settle__error">
                    {error}
                  </p>
                )}
                {flash !== '' && <span className="split-settle__flash">{flash}</span>}
              </div>
              <button type="button" className="split-settle__btn split-settle__btn--small" disabled={chosen.length === 0} onClick={clearSelection}>
                選択を解除
              </button>
              <button
                type="button"
                className="split-settle__btn split-settle__btn--small split-settle__btn--primary"
                disabled={submitting || chosen.length === 0 || totalsMismatch}
                onClick={() => void commit()}
              >
                割勘を記録
              </button>
            </div>

            {!barCollapsed && (
            <div id="split-bar-fields" className="split-settle__panel-grid split-settle__bar-fields">
              <div className="split-settle__field split-settle__field--mode">
                <label className="split-settle__label" htmlFor="split-mode">
                  按分の方法
                </label>
                <select
                  id="split-mode"
                  className="split-settle__control"
                  aria-label="按分の方法"
                  value={mode}
                  onChange={(e) => changeMode(e.target.value as ExpenseSplittingAllocationMode)}
                >
                  {(['ratio', 'equal', 'amount'] as const).map((m) => (
                    <option key={m} value={m} disabled={m === 'amount' && amountModeBlocked}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
                {amountModeBlocked && (
                  <span className="split-settle__note">借方と貸方が差し引きで0円のため、金額は指定できません。</span>
                )}
              </div>

              <div className="split-settle__partners">
                <span className="split-settle__label">誰がどのくらい負担するか</span>
                {partners.map((row) => (
                  <div key={row.key} className="split-settle__partner">
                    <div className="split-settle__partner-pick">
                      <TreeSelect
                        label="分担相手"
                        categories={categoriesFor(row)}
                        value={toPartnerValue(row)}
                        onChange={(value) => patchPartner(row.key, parsePartnerValue(value))}
                        placeholder="相手を選ぶ"
                        onCreate={() => setCreateForRowKey(row.key)}
                        createLabel="取引先を追加"
                      />
                    </div>
                    {mode === 'ratio' && (
                      <>
                        <input
                          className="split-settle__control split-settle__control--narrow"
                          inputMode="numeric"
                          aria-label={`${partnerName(row)}の負担割合(%)`}
                          value={row.ratioInput}
                          onChange={(e) => patchPartner(row.key, { ratioInput: e.target.value })}
                        />
                        <span className="split-settle__unit">%</span>
                      </>
                    )}
                    {mode === 'amount' && (
                      <input
                        className="split-settle__control split-settle__control--amount"
                        inputMode="numeric"
                        aria-label={`${partnerName(row)}の負担額を入力`}
                        value={row.amountInput}
                        onChange={(e) => patchPartner(row.key, { amountInput: e.target.value })}
                      />
                    )}
                    {/* ×は入力欄のすぐ右に置く。負担額の表示欄より前に置くことで、金額が出ても位置が動かない。負担額が無いときは表示欄の幅を取らない */}
                    <button
                      type="button"
                      className="split-settle__icon-btn"
                      aria-label={`${partnerName(row)}を分担相手から外す`}
                      disabled={partners.length <= 1}
                      onClick={() => {
                        setRatiosTouched(false)
                        setAmountsTouched(false)
                        setPartners((prev) => prev.filter((p) => p.key !== row.key))
                      }}
                    >
                      ×
                    </button>
                    <span className={`split-settle__num split-settle__share${burdenOf(row.key) === null ? ' split-settle__share--empty' : ''}`}>
                      {burdenOf(row.key) === null ? '' : formatCurrency(burdenOf(row.key) ?? 0, 'JPY')}
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  className="split-settle__add"
                  onClick={() => {
                    setRatiosTouched(false)
                    setAmountsTouched(false)
                    setPartners((prev) => [
                      ...prev,
                      { key: nextKey.current++, kind: 'householdMember', targetId: null, ratioInput: '', amountInput: '' },
                    ])
                    setFlash('')
                  }}
                >
                  + 分担相手を追加
                </button>
                {error !== '' && errorTarget === 'partner' && (
                  <p role="alert" className="split-settle__error">
                    {error}
                  </p>
                )}
              </div>

              <div className="split-settle__field split-settle__field--memo">
                <label className="split-settle__label" htmlFor="split-memo">
                  摘要
                </label>
                <input
                  id="split-memo"
                  className="split-settle__control"
                  required
                  aria-required="true"
                  value={memoInput}
                  placeholder={chosen.length === 0 ? '' : memoExample(chosen)}
                  onChange={(e) => {
                    setMemoInput(e.target.value)
                    setFlash('')
                  }}
                />
                {error !== '' && errorTarget === 'memo' && (
                  <p role="alert" className="split-settle__error">
                    {error}
                  </p>
                )}
              </div>

              <div className="split-settle__field split-settle__field--batch">
                <span className="split-settle__label">精算バッチ</span>
                {/* 「新しいバッチを作成」は操作ではなく既定の選択状態(記録するときに作る)なので、先頭に固定した項目にする */}
                <BatchSelect
                  label="精算バッチ"
                  batches={data.batches}
                  value={String(batchId)}
                  leadingOptions={NEW_BATCH_OPTIONS}
                  onChange={(value) => setBatchId(value === 'new' ? 'new' : Number(value))}
                />
                {/* 新しいバッチを作るときだけ、摘要がバッチの名前になる */}
                {batchId === 'new' && <span className="split-settle__note">摘要がバッチの名前になります。</span>}
              </div>
            </div>
            )}
          </section>
        </div>

        <section ref={lineCardRef} aria-label="割勘する行" className="split-settle__card split-settle__card--table journal-line-table">
          <p className="split-settle__note split-settle__note--pad">
            仕訳の明細行を選んで割勘します。費用・収益の行(借方・貸方とも)だけ選べます。割勘済みの行は表示しません。借方と貸方を
            一緒に選ぶと、貸方(返金・値引き・収益)を差し引いた額を割ります。
          </p>
          {!columns.isDefault && (
            <div className="split-settle__note split-settle__note--pad">
              <button type="button" className="split-settle__add" onClick={columns.resetAll}>
                列幅を初期値に戻す
              </button>
            </div>
          )}
          <StickyHeaderTable
            frameClassName="split-settle__scroll"
            tableClassName="journal-line-table__table split-settle__line-table"
            floatingClassName="floating-table-header--lines"
            tableStyle={{ minWidth: tableWidth }}
            head={
              <>
                <colgroup>
                  <col style={{ width: widths.date }} />
                  <col style={{ width: widths.memo }} />
                  <col style={{ width: widths.comment }} />
                  {(['debit', 'credit'] as const).flatMap((side) => [
                    <col key={`${side}-check`} style={{ width: CHECK_COLUMN_WIDTH }} />,
                    <col key={`${side}-account`} style={{ width: widths.account }} />,
                    <col key={`${side}-partner`} style={{ width: widths.partner }} />,
                    <col key={`${side}-member`} style={{ width: widths.member }} />,
                    <col key={`${side}-amount`} style={{ width: widths.amount }} />,
                  ])}
                </colgroup>
                <thead>
                  <tr>
                    {sortHead('date', '日付', resizeHandle('date', '日付'))}
                    {sortHead('memo', '摘要', resizeHandle('memo', '摘要'))}
                    {sortHead('comment', 'コメント', resizeHandle('comment', 'コメント'))}
                    {(['debit', 'credit'] as const).flatMap((side) => [
                      <th
                        key={`${side}-check`}
                        className={`journal-line-table__cell--check ${side === 'debit' ? 'journal-line-table__debit-start' : 'journal-line-table__credit-start'}`}
                      >
                        {sideHeadCheck(side)}
                      </th>,
                      sortHead(`${side}-account`, `${SIDE_LABEL[side]}の科目`, resizeHandle('account', `${SIDE_LABEL[side]}の科目`)),
                      sortHead(`${side}-partner`, '取引先・精算バッチ', resizeHandle('partner', `${SIDE_LABEL[side]}の取引先・精算バッチ`)),
                      sortHead(`${side}-member`, '世帯メンバー', resizeHandle('member', `${SIDE_LABEL[side]}の世帯メンバー`)),
                      sortHead(`${side}-amount`, '金額', resizeHandle('amount', `${SIDE_LABEL[side]}の金額`), 'journal-line-table__cell--amount'),
                    ])}
                  </tr>
                </thead>
              </>
            }
          >
            <tbody>
              {rows.map((row, index) => {
                const memo = row.entry.memo ?? ''
                return (
                  <tr key={`${row.entry.id}:${index}`} className={row.isFirst && index > 0 ? 'split-settle__entry-start' : undefined}>
                    <td className="journal-line-table__cell">{row.isFirst ? formatDate(toDate(row.entry.entryDate)) : ''}</td>
                    <td className="journal-line-table__cell">
                      {row.isFirst && (
                        <button type="button" className="journal-line-table__memo" onClick={() => setDetailEntryId(row.entry.id)}>
                          {memo === '' ? '(摘要なし)' : memo}
                        </button>
                      )}
                    </td>
                    <td className="journal-line-table__cell" title={row.isFirst ? (row.entry.comment ?? undefined) : undefined}>
                      {row.isFirst ? (row.entry.comment ?? '') : ''}
                    </td>
                    {sideCells(row.debit, 'debit')}
                    {sideCells(row.credit, 'credit')}
                  </tr>
                )
              })}
            </tbody>
          </StickyHeaderTable>
          <ListLoadMore
            total={shown.length}
            shown={shownCount}
            pageSize={SPLIT_LIST_PAGE_SIZE.candidate}
            onMore={() => setDisplayLimit(nextDisplayLimit(shownCount, SPLIT_LIST_PAGE_SIZE.candidate))}
          />
        </section>

        {previews.length > 0 && (
          <section aria-label="割勘仕訳のプレビュー" className="split-settle__card split-settle__card--table journal-line-table">
            <div className="split-settle__preview-head">
              <h2 className="split-settle__h2">割勘仕訳のプレビュー</h2>
              <span className="split-settle__note">
                {`取引日 ${today}・${memoInput.trim() === '' ? '摘要は未入力です' : `摘要「${memoInput.trim()}」`}。分担相手ごとに1件の仕訳になります。`}
              </span>
            </div>
            {previews.map((preview) => (
              <div key={preview.rowKey} className="split-settle__scroll">
                <table className="journal-line-table__table split-settle__preview-table" aria-label={`${preview.partnerName}さん分の割勘仕訳`}>
                  {/* 列幅は割合で固定し、分担相手ごとの表で縦線(特に金額の列)をそろえる */}
                  <colgroup>
                    {PREVIEW_COLUMN_PERCENTS.map((percent, i) => (
                      <col key={i} style={{ width: `${percent}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="journal-line-table__debit-start">{`${preview.partnerName}さん分 借方の科目`}</th>
                      <th>世帯メンバー</th>
                      <th>取引先・精算バッチ</th>
                      <th className="journal-line-table__cell--amount">金額</th>
                      <th className="journal-line-table__credit-start">貸方の科目</th>
                      <th>世帯メンバー</th>
                      <th>取引先・精算バッチ</th>
                      <th className="journal-line-table__cell--amount">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        <td className="journal-line-table__cell journal-line-table__debit-start">{row.debit?.accountName ?? ''}</td>
                        <td className="journal-line-table__cell">{row.debit?.memberName ?? ''}</td>
                        <td className="journal-line-table__cell">{row.debit?.partner ?? ''}</td>
                        <td className="journal-line-table__cell journal-line-table__cell--amount">
                          {row.debit === null ? '' : formatCurrency(row.debit.amount, 'JPY')}
                        </td>
                        <td className="journal-line-table__cell journal-line-table__credit-start">{row.credit?.accountName ?? ''}</td>
                        <td className="journal-line-table__cell">{row.credit?.memberName ?? ''}</td>
                        <td className="journal-line-table__cell">{row.credit?.partner ?? ''}</td>
                        <td className="journal-line-table__cell journal-line-table__cell--amount">
                          {row.credit === null ? '' : formatCurrency(row.credit.amount, 'JPY')}
                        </td>
                      </tr>
                    ))}
                    <tr className="split-settle__preview-total">
                      <td className="journal-line-table__cell journal-line-table__debit-start" colSpan={3}>
                        借方の合計
                      </td>
                      <td className="journal-line-table__cell journal-line-table__cell--amount">{formatCurrency(preview.debitTotal, 'JPY')}</td>
                      <td className="journal-line-table__cell journal-line-table__credit-start" colSpan={3}>
                        貸方の合計
                      </td>
                      <td className="journal-line-table__cell journal-line-table__cell--amount">{formatCurrency(preview.creditTotal, 'JPY')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
            <p className="split-settle__note split-settle__note--pad">
              貸方の行(返金・値引き・収益)は、費用・収益の付け替えを逆向きにします。未収金と未払金は、借方・貸方の差し引き(純額)で
              1行ずつにします。
            </p>
          </section>
        )}
      </div>

      {detailEntry !== undefined && (
        <EntryDetailDialog
          entry={detailEntry}
          accounts={data.accounts}
          members={data.members}
          counterparties={data.counterparties}
          batches={data.batches}
          onClose={() => setDetailEntryId(null)}
        />
      )}

      {createForRowKey !== null && (
        <QuickCreateDialog
          title="取引先を追加"
          nameLabel="取引先名"
          onSubmit={async (name) => {
            const created = await repositories.counterpartyRepository.create({ name })
            patchPartner(createForRowKey, { kind: 'counterparty', targetId: created.id })
            setCreateForRowKey(null)
            await onChanged()
          }}
          onCancel={() => setCreateForRowKey(null)}
        />
      )}
    </>
  )
}
