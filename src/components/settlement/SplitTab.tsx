import { useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { buildPartnerCategories, parsePartnerValue, toPartnerValue } from './splitSettleModel'
import { buildSplitLineTableRows, selectableLineIdsBySide } from './splitLineTableModel'
import { buildSplitPreviews } from './splitPreviewModel'
import { StickyHeaderTable } from '../common/sticky/StickyHeaderTable'
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
  amountNetZero: '選んだ行の借方と貸方が差し引きで0円のため、金額を指定できません。割合か均等で分けてください',
  amountExceedsTotal: '指定した金額の合計が、選んだ行の差し引きの合計を超えています',
}

/** 割勘タブのバッチの先頭に固定する「新しいバッチを作成」(記録するときにバッチを作る既定の選択状態)。参照を安定させるため定数にする */
const NEW_BATCH_OPTIONS = [{ value: 'new', label: '新しいバッチを作成' }]

const MODE_LABEL: Record<ExpenseSplittingAllocationMode, string> = {
  ratio: '割合で分ける',
  equal: '均等に分ける',
  amount: '金額を指定する',
}

const SIDE_LABEL: Record<JournalLineSide, string> = { debit: '借方', credit: '貸方' }

/** 候補の表の列幅の保存先。仕訳一覧の明細行単位の表とは別に持つ(同じつまみ・同じ保存の仕組みを使う、計画Issue #271) */
const COLUMN_WIDTHS_STORAGE_KEY = 'localbudget:split-line-table-column-widths'
/** 行のチェックの列の幅(px)。固定で、列幅の調整の対象外 */
const CHECK_COLUMN_WIDTH = 32

/** 割勘する行の既定の摘要。精算バッチを新規作成するときの名前にもなる(精算タブで変更できる) */
function defaultMemo(chosen: readonly SelectedSplitLine[]): string {
  const entryIds = new Set(chosen.map((c) => c.entry.id))
  if (entryIds.size === 1) {
    const memo = chosen[0].entry.memo
    return memo === null || memo === '' ? '割勘' : `${memo}の割勘`
  }
  return `${chosen.length}行の割勘`
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
  const columns = useJournalLineTableColumns(COLUMN_WIDTHS_STORAGE_KEY)
  const { widths } = columns

  const relatedIds = useMemo(() => buildRelatedEntryIdsByEntryId(data.memberships), [data.memberships])
  const candidates = useMemo(
    () => listSplittableLineEntries(data.entries, data.accounts, relatedIds, data.sourceLinks),
    [data.entries, data.accounts, relatedIds, data.sourceLinks],
  )

  const [checkedIds, setCheckedIds] = useState<ReadonlySet<number>>(
    () => new Set(selectableLineIdsOfEntries(candidates, initialCheckedEntryIds)),
  )
  const nextKey = useRef(2)
  const [partners, setPartners] = useState<ExpenseSplittingParticipantRow[]>([
    { key: 1, kind: 'householdMember', targetId: null, ratioInput: '50', amountInput: '' },
  ])
  const [mode, setMode] = useState<ExpenseSplittingAllocationMode>('ratio')
  const [batchId, setBatchId] = useState<number | 'new'>('new')
  const [memoInput, setMemoInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [createForRowKey, setCreateForRowKey] = useState<number | null>(null)
  /** 「さらに表示」で増やした表示件数の上限。絞り込み条件を変えると先頭の1ページ分に戻す */
  const [displayLimit, setDisplayLimit] = useState<number>(SPLIT_LIST_PAGE_SIZE.candidate)
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null)

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
  const visible = useMemo(() => shown.slice(0, shownCount), [shown, shownCount])
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
  const payerIds = new Set(chosen.map((c) => c.entry.householdMemberId))
  const amountModeBlocked = chosen.length > 0 && net === 0

  const partnerCategories = useMemo(
    () => buildPartnerCategories(data.members, derived.counterpartyCategories, payerIds),
    // payerIdsは選んだ行から毎回作る集合なので、中身の文字列で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.members, derived.counterpartyCategories, [...payerIds].sort().join(',')],
  )

  // 相手ごとの負担額(送信時と同じ計算)。計算できないとき(金額指定で合計超過など)は金額指定の入力額をそのまま出す
  const plan = planLineExpenseSplit({ selectedLines: chosen, accounts: data.accounts, participants: partners, allocationMode: mode })
  const shareByKey = new Map<number, number>()
  for (const row of partners) {
    if (plan.ok) {
      const planned = plan.recipients.find((r) => r.row.key === row.key)
      shareByKey.set(row.key, planned === undefined ? 0 : planned.signedShares.reduce((sum, n) => sum + n, 0))
    } else if (mode === 'amount') {
      shareByKey.set(row.key, Number(row.amountInput) || 0)
    } else {
      shareByKey.set(row.key, 0)
    }
  }
  const totalShare = [...shareByKey.values()].reduce((sum, n) => sum + n, 0)
  /** 選んでいる行の組み合わせでは記録できない理由(選択・入力を直すと消える) */
  const planError = chosen.length > 0 && !plan.ok && (mode === 'amount' ? plan.error !== 'noRecipient' : false) ? plan.error : null

  const batchLabel =
    batchId === 'new'
      ? memoInput.trim() === ''
        ? chosen.length === 0
          ? ''
          : defaultMemo(chosen)
        : memoInput.trim()
      : (data.batches.find((b) => b.id === batchId)?.name ?? '')
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
    setPartners((prev) => prev.map((p) => (p.key === key ? { ...p, ...changes } : p)))
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
  // Esc で行のチェックをすべて外す
  useEscapeToClear(
    checkedIds.size > 0
      ? () => {
          setCheckedIds(new Set())
          setFlash('')
          setError('')
        }
      : null,
  )

  const changeFilter = (next: JournalEntryFilter) => {
    setDisplayLimit(SPLIT_LIST_PAGE_SIZE.candidate)
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
    if (partners.some((p) => p.targetId === null)) {
      setError(ERROR_TEXT.counterpartyTargetRequired)
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
          memo: memoInput.trim() === '' ? defaultMemo(chosen) : memoInput.trim(),
          settlementBatchId: batchId,
          today,
          repositories,
        }),
      )
      if (!result.ok) {
        setError(ERROR_TEXT[result.error])
        return
      }
      setCheckedIds(new Set())
      setBatchId('new')
      setMemoInput('')
      await onChanged()
      setFlash('割勘を記録しました')
    } catch {
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

  /** 見出しの右端の列幅のつまみ。借方と貸方の同じ種類の列は連動する。表の幅は列幅の合計に固定するので、ドラッグ量はそのまま列の幅になる(scale 1) */
  const resizeHandle = (key: ColumnKey, label: string) => (
    <JournalLineTableResizeHandle
      label={`${label}の列幅`}
      value={widths[key]}
      getScale={() => 1}
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
      <div className="split-settle__stack" style={{ '--sticky-head-extra': `${filterHeight}px` } as CSSProperties}>
        <section aria-label="割勘する行" className="split-settle__card split-settle__card--table journal-line-table">
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
            tableStyle={{ width: tableWidth }}
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
                    <th>
                      日付
                      {resizeHandle('date', '日付')}
                    </th>
                    <th>
                      摘要
                      {resizeHandle('memo', '摘要')}
                    </th>
                    <th>
                      コメント
                      {resizeHandle('comment', 'コメント')}
                    </th>
                    {(['debit', 'credit'] as const).flatMap((side) => [
                      <th
                        key={`${side}-check`}
                        className={`journal-line-table__cell--check ${side === 'debit' ? 'journal-line-table__debit-start' : 'journal-line-table__credit-start'}`}
                      >
                        {sideHeadCheck(side)}
                      </th>,
                      <th key={`${side}-account`}>
                        {`${SIDE_LABEL[side]}の科目`}
                        {resizeHandle('account', `${SIDE_LABEL[side]}の科目`)}
                      </th>,
                      <th key={`${side}-partner`}>
                        取引先・精算バッチ
                        {resizeHandle('partner', `${SIDE_LABEL[side]}の取引先・精算バッチ`)}
                      </th>,
                      <th key={`${side}-member`}>
                        世帯メンバー
                        {resizeHandle('member', `${SIDE_LABEL[side]}の世帯メンバー`)}
                      </th>,
                      <th key={`${side}-amount`} className="journal-line-table__cell--amount">
                        金額
                        {resizeHandle('amount', `${SIDE_LABEL[side]}の金額`)}
                      </th>,
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
                    <td className="journal-line-table__cell">{row.isFirst ? row.entry.entryDate : ''}</td>
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

        <section aria-label="分担" className="split-settle__card split-settle__panel-wide">
          <h2 className="split-settle__h2">分担</h2>
          <div className="split-settle__summary">
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

          <div className="split-settle__panel-grid">
            <div className="split-settle__field">
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
              <span className="split-settle__label">分担相手と負担割合</span>
              {partners.map((row) => (
                <div key={row.key} className="split-settle__partner">
                  <div className="split-settle__partner-pick">
                    <TreeSelect
                      label="分担相手"
                      categories={partnerCategories}
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
                  <span className="split-settle__num split-settle__share">
                    {formatCurrency(shareByKey.get(row.key) ?? 0, 'JPY')}
                  </span>
                  <button
                    type="button"
                    className="split-settle__icon-btn"
                    aria-label={`${partnerName(row)}を分担相手から外す`}
                    disabled={partners.length <= 1}
                    onClick={() => setPartners((prev) => prev.filter((p) => p.key !== row.key))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="split-settle__add"
                onClick={() => {
                  setPartners((prev) => [
                    ...prev,
                    { key: nextKey.current++, kind: 'householdMember', targetId: null, ratioInput: '', amountInput: '' },
                  ])
                  setFlash('')
                }}
              >
                + 分担相手を追加
              </button>
            </div>

            <div className="split-settle__field">
              <label className="split-settle__label" htmlFor="split-memo">
                摘要
              </label>
              <input
                id="split-memo"
                className="split-settle__control"
                value={memoInput}
                placeholder={chosen.length === 0 ? '' : defaultMemo(chosen)}
                onChange={(e) => {
                  setMemoInput(e.target.value)
                  setFlash('')
                }}
              />
              <span className="split-settle__note">
                新しい精算バッチを作るときは、この摘要がバッチの名前になります。空のときは例の摘要を使います。
              </span>
            </div>

            <div className="split-settle__field">
              <span className="split-settle__label">精算バッチ</span>
              {/* 「新しいバッチを作成」は操作ではなく既定の選択状態(記録するときに作る)なので、先頭に固定した項目にする */}
              <BatchSelect
                label="精算バッチ"
                batches={data.batches}
                value={String(batchId)}
                leadingOptions={NEW_BATCH_OPTIONS}
                onChange={(value) => setBatchId(value === 'new' ? 'new' : Number(value))}
              />
            </div>
          </div>

          <div className="split-settle__commit">
            <div className="split-settle__line split-settle__line--total">
              <span>相手の負担額</span>
              <span className="split-settle__num">{formatCurrency(totalShare, 'JPY')}</span>
            </div>
            <button
              type="button"
              className="split-settle__btn split-settle__btn--primary"
              disabled={submitting || chosen.length === 0}
              onClick={() => void commit()}
            >
              割勘を記録
            </button>
          </div>
          {planError !== null && (
            <p role="status" className="split-settle__note">
              {ERROR_TEXT[planError]}
            </p>
          )}
          {error !== '' && (
            <p role="alert" className="split-settle__error">
              {error}
            </p>
          )}
          {flash !== '' && <span className="split-settle__flash">{flash}</span>}
        </section>

        {previews.length > 0 && (
          <section aria-label="割勘仕訳のプレビュー" className="split-settle__card split-settle__card--table journal-line-table">
            <div className="split-settle__preview-head">
              <h2 className="split-settle__h2">割勘仕訳のプレビュー</h2>
              <span className="split-settle__note">
                {`取引日 ${today}・摘要「${memoInput.trim() === '' ? defaultMemo(chosen) : memoInput.trim()}」。分担相手ごとに1件の仕訳になります。`}
              </span>
            </div>
            {previews.map((preview) => (
              <div key={preview.rowKey} className="split-settle__scroll">
                <table className="journal-line-table__table split-settle__preview-table" aria-label={`${preview.partnerName}さん分の割勘仕訳`}>
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
                      <th className="journal-line-table__credit-start">元の行</th>
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
                        <td className="journal-line-table__cell journal-line-table__credit-start split-settle__cell--source">{row.source}</td>
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
                      <td className="journal-line-table__cell journal-line-table__credit-start" />
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
