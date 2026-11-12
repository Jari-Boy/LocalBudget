import { useRef, useState, type ReactNode } from 'react'
import type { JournalEntry, JournalLine, JournalLineSide } from '../../domain/journal/JournalEntry'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../infrastructure/i18n/formatDate'
import { SOURCE_TAGS } from '../common/journal-result/journalResultModel'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { createEmptyJournalEntryFormLine, isCounterpartyEligibleCategory, type JournalEntryFormLine } from './journalEntryFormLine'
import type { JournalEditorLine, JournalEditorMaster, JournalEditorValue } from './JournalEntryEditor'
import { applyAccountChange } from './journalLineAccountChange'
import {
  DEFAULT_COLUMN_WIDTHS,
  LEFT_COLUMN_KEYS,
  SIDE_COLUMN_KEYS,
  isDefaultColumnWidths,
  loadColumnWidths,
  resizeColumn,
  saveColumnWidths,
  totalTableWidth,
  type ColumnKey,
} from './journalLineTableColumns'
import { JournalLineTableResizeHandle } from './JournalLineTableResizeHandle'
import { pairLinesBySide } from './journalLineTableModel'
import { summarizeBalance } from './journalScreenModel'
import './JournalLineTable.css'

/** 表に出す名前の解決(ID → 表示名)。該当がなければ空文字を返す(科目だけは「不明」を返してよい) */
export interface JournalLineTableLookup {
  accountName: (id: number) => string
  projectName: (id: number) => string
  counterpartyName: (id: number) => string
  batchName: (id: number) => string
  memberName: (id: number) => string
}

/** インライン編集中の仕訳(同時に編集できるのは1仕訳だけ)。編集内容と保存・削除などの実処理は親が持つ */
export interface JournalLineTableEditing {
  entryId: number
  value: JournalEditorValue
  onChange: (value: JournalEditorValue) => void
  master: JournalEditorMaster
  /** 保存・削除の処理中。保存を押せなくする */
  busy: boolean
  onSave: () => void
  onCancel: () => void
  /** 「仕訳を削除」。1回目は親が確認表示(deleteArmed)に切り替え、確認中の「本当に削除する」で実際に消す */
  onDelete: () => void
  onDeleteCancel: () => void
  deleteArmed: boolean
  /** 削除の確認で、元に戻せない旨に添える影響の表示(精算バッチの取り消しなど) */
  deleteNotes?: readonly string[]
  /** 保存などで出たエラー(明細行単位には詳細パネルがないため、操作バーに出す) */
  error?: string
  /** 渡すと、取引先の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ取引先のIDを渡す */
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
  /** 渡すと、プロジェクトの選択ツリーに「+ 新規追加」を出す */
  onRequestCreateProject?: (apply: (id: number) => void) => void
  /** 渡すと、科目の選択ツリーに「+ 新規追加」を出す */
  onRequestCreateAccount?: (apply: (id: number) => void) => void
}

/**
 * 一括編集(計画Issue #182)のための行の選択。渡すと、借方側・貸方側の先頭に、明細1行ごとのチェックボックスの列と、
 * 各側の見出しの全選択のチェックボックスが出る。選択の状態と一括編集の処理は呼び出し側が持つ
 */
export interface JournalLineTableBulk {
  /** 選択中の明細行のid */
  selectedLineIds: ReadonlySet<number>
  /** チェックを押せない(インライン編集中など) */
  disabled: boolean
  /** 行のチェック。仕訳の選択(行を押す操作)にはならない */
  onToggleLine: (lineId: number) => void
  /** 見出しのチェック: その側の表示中の行をすべて選ぶ(すべて選択済みなら外す) */
  onToggleSide: (side: JournalLineSide) => void
}

export interface JournalLineTableProps {
  entries: readonly JournalEntry[]
  lookup: JournalLineTableLookup
  /** 渡すと、一括編集のための行の選択の列を出す */
  bulk?: JournalLineTableBulk
  /** 選択中の仕訳。その仕訳のすべての行を強調する */
  selectedId: number | null
  /**
   * どの行を押しても、その仕訳が選ばれる(選択は仕訳単位)。編集中の仕訳の行は押しても呼ばれない。
   * 呼び出し側は、選ばれた仕訳をそのまま編集中にする(編集ボタンはない)
   */
  onSelect: (entryId: number) => void
  /** 編集中の仕訳。渡すと、その仕訳の全行が入力欄になり、下に操作バーが出る */
  editing?: JournalLineTableEditing
}

/**
 * 借方・貸方それぞれの列。取引先は費用・収益の科目の行だけ、精算バッチはシステム管理の立替金・未払金の行だけが
 * 持てて、同じ行に両方が付くことはないため、1列(「取引先・精算バッチ」)にまとめる
 */
const SIDE_COLUMNS = ['科目', 'プロジェクト', '取引先・精算バッチ', '世帯メンバー', '金額'] as const
/** 日付〜コメントの列の名前(LEFT_COLUMN_KEYS と同じ並び) */
const LEFT_COLUMNS = ['日付', '出どころ', '摘要', 'コメント'] as const
const SIDE_LABEL: Record<JournalLineSide, string> = { debit: '借方', credit: '貸方' }
/** 表の列数(日付・出どころ・摘要・コメント + 借方5列 + 貸方5列) */
const COLUMN_COUNT = 4 + SIDE_COLUMNS.length * 2

function toDate(entryDate: string): Date {
  const [year, month, day] = entryDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 一括編集の選択の列の幅(px)。借方・貸方それぞれの先頭に1列。幅は固定で、列幅の調整の対象外 */
const CHECK_COLUMN_WIDTH = 32

/** 借方・貸方の先頭の列には、境目の縦線のクラスを付ける */
function sideStartClass(side: JournalLineSide): string {
  return side === 'debit' ? 'journal-line-table__debit-start' : 'journal-line-table__credit-start'
}

/** hasCheck=選択の列がある。あるときは、境目の縦線は選択の列(各側の先頭)に付き、科目の列には付かない */
function cellClass(i: number, side: JournalLineSide, hasCheck: boolean): string {
  return [
    'journal-line-table__cell',
    i === 0 ? 'journal-line-table__cell--account' : '',
    i === 0 && !hasCheck ? sideStartClass(side) : '',
    i === SIDE_COLUMNS.length - 1 ? 'journal-line-table__cell--amount' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** 一括編集の選択のチェックボックス。indeterminate は属性にできないため、描画のたびに要素へ設定する */
function BulkCheckbox({
  label,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  indeterminate?: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    <input
      type="checkbox"
      className="journal-line-table__checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate
      }}
      // 行を押す操作(仕訳の選択・編集の開始)にならないようにする
      onClick={(event) => event.stopPropagation()}
      onChange={onChange}
    />
  )
}

/**
 * 仕訳一覧の「明細行単位」の表(計画Issue #182)。借方の明細行を左・貸方の明細行を右に、行番号で
 * 対応づけて並べる(複合仕訳は行が増え、足りない側は空欄)。日付・出どころ・摘要・コメントは
 * 仕訳の先頭行だけに出し、仕訳の境目は区切り線で分ける(仕訳ごとに tbody を分ける)。どの行を
 * 押しても選択は仕訳単位。幅が足りないときは、表を囲む枠が横スクロールする。
 * 行を押すと、その仕訳の全行が入力欄になる(インライン編集。編集ボタンはない。編集の単位は仕訳で、同時に
 * 編集できるのは1仕訳だけ)。編集中の仕訳の下に操作バーを出し、借方・貸方それぞれの列の下に行の追加と合計、
 * 下段に貸借の一致状況と削除・キャンセル・保存を置く。貸借が合わない間と保存中は保存できない。
 * 列の境目のつまみで列幅を調整できる(ドラッグ・キーボード・ダブルクリック)。借方と貸方の同じ種類の列は
 * 連動して同じ幅になり、調整した列幅はlocalStorageに保存して再訪時に復元する。表の上の「列幅を初期値に戻す」で
 * すべての列を初期の幅に戻せる。
 * 表示用の名前解決(lookup)と編集内容(値と変更通知)だけを受け取り、DB・Repositoryには依存しない。
 */
export function JournalLineTable({ entries, lookup, selectedId, onSelect, editing, bulk }: JournalLineTableProps) {
  // ---- 列幅の調整(フックは、仕訳がないときの早期returnより前に置く) ----
  const [widths, setWidths] = useState(loadColumnWidths)
  /** 最新の列幅。ドラッグ・キー操作の途中で、再描画を待たずに次の幅を求めるため */
  const widthsRef = useRef(widths)
  const tableRef = useRef<HTMLTableElement>(null)

  const applyWidths = (next: typeof widths) => {
    widthsRef.current = next
    setWidths(next)
  }
  const resizeTo = (key: ColumnKey, width: number) => applyWidths(resizeColumn(widthsRef.current, key, width))
  const resetColumn = (key: ColumnKey) => {
    applyWidths({ ...widthsRef.current, [key]: DEFAULT_COLUMN_WIDTHS[key] })
    saveColumnWidths(widthsRef.current)
  }
  const resetAllColumns = () => {
    applyWidths({ ...DEFAULT_COLUMN_WIDTHS })
    saveColumnWidths(widthsRef.current)
  }
  /** 一括編集の選択の列(借方・貸方の2列)の分の幅 */
  const checkColumnsWidth = bulk === undefined ? 0 : 2 * CHECK_COLUMN_WIDTH
  /** 画面に出ている表の幅 ÷ 列幅の合計(枠が広くて余った幅が各列に配られているとき、1より大きくなる) */
  const getScale = () => {
    const shown = tableRef.current?.offsetWidth ?? 0
    return shown > 0 ? shown / (totalTableWidth(widthsRef.current) + checkColumnsWidth) : 1
  }

  const resizeHandle = (key: ColumnKey, label: string) => (
    <JournalLineTableResizeHandle
      label={`${label}の列幅`}
      value={widths[key]}
      getScale={getScale}
      onResize={(width) => resizeTo(key, width)}
      onCommit={() => saveColumnWidths(widthsRef.current)}
      onReset={() => resetColumn(key)}
    />
  )

  if (entries.length === 0) {
    return <p className="journal-line-table__empty">該当する仕訳がありません</p>
  }

  const accountById = editing === undefined ? new Map() : new Map(editing.master.accounts.map((a) => [a.id, a]))
  const memberById = editing === undefined ? new Map() : new Map(editing.master.members.map((m) => [m.id, m]))

  // ---- 一括編集の行の選択 ----
  const hasCheck = bulk !== undefined
  /** 借方・貸方の各側の列の数(選択の列があれば、その分を足す) */
  const sideSpan = SIDE_COLUMNS.length + (hasCheck ? 1 : 0)
  const isLineSelected = (line: JournalLine | null) => bulk !== undefined && line !== null && bulk.selectedLineIds.has(line.id)

  /** 閲覧の行の選択の列(足りない側の空欄にはチェックボックスを出さない) */
  const checkCell = (line: JournalLine | null, side: JournalLineSide): ReactNode =>
    bulk === undefined ? null : (
      <td
        key="check"
        className={['journal-line-table__cell', 'journal-line-table__cell--check', sideStartClass(side), isLineSelected(line) ? 'journal-line-table__cell--bulk-selected' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {line !== null && (
          <BulkCheckbox
            label={`${SIDE_LABEL[side]}の行を選択`}
            checked={isLineSelected(line)}
            disabled={bulk.disabled}
            onChange={() => bulk.onToggleLine(line.id)}
          />
        )}
      </td>
    )

  /** 見出しの全選択: その側の表示中の行がすべて選ばれていればチェック、一部なら中間 */
  const sideHeadCheck = (side: JournalLineSide): ReactNode => {
    if (bulk === undefined) return null
    const lines = entries.flatMap((e) => e.lines).filter((l) => l.side === side)
    const selectedCount = lines.filter((l) => bulk.selectedLineIds.has(l.id)).length
    return (
      <BulkCheckbox
        label={`${SIDE_LABEL[side]}の行をすべて選択`}
        checked={lines.length > 0 && selectedCount === lines.length}
        indeterminate={selectedCount > 0 && selectedCount < lines.length}
        disabled={bulk.disabled || lines.length === 0}
        onChange={() => bulk.onToggleSide(side)}
      />
    )
  }

  // ---- 閲覧 ----
  const viewSideCells = (line: JournalLine | null, currency: string, side: JournalLineSide) => {
    const text = (value: string | undefined) => value ?? ''
    // 取引先と精算バッチは同じ行に両方付かないため、付いている方を1列に出す
    const partner =
      line?.counterpartyId != null
        ? text(lookup.counterpartyName(line.counterpartyId))
        : line?.settlementBatchId != null
          ? text(lookup.batchName(line.settlementBatchId))
          : ''
    const values = [
      line === null ? '' : lookup.accountName(line.accountId),
      line?.projectId == null ? '' : text(lookup.projectName(line.projectId)),
      partner,
      line === null ? '' : lookup.memberName(line.householdMemberId),
      line === null ? '' : formatCurrency(line.amount, currency),
    ]
    const selectedClass = isLineSelected(line) ? ' journal-line-table__cell--bulk-selected' : ''
    return [
      checkCell(line, side),
      ...values.map((value, i) => (
        <td key={SIDE_COLUMNS[i]} className={cellClass(i, side, hasCheck) + selectedClass}>
          {value}
        </td>
      )),
    ]
  }

  // ---- 編集 ----
  const update = (patch: Partial<JournalEditorValue>) => {
    if (editing !== undefined) editing.onChange({ ...editing.value, ...patch })
  }

  const updateLine = (key: number, change: (line: JournalEntryFormLine) => JournalEntryFormLine) => {
    if (editing === undefined) return
    update({ lines: editing.value.lines.map((l) => (l.key === key ? { key, line: change(l.line) } : l)) })
  }

  const addLine = (side: JournalLineSide) => {
    if (editing === undefined) return
    const lines = editing.value.lines
    const key = lines.reduce((max, l) => Math.max(max, l.key), 0) + 1
    update({
      lines: [...lines, { key, line: { ...createEmptyJournalEntryFormLine(), side, householdMemberId: editing.value.householdMemberId } }],
    })
  }

  const removeLine = (key: number) => {
    if (editing !== undefined) update({ lines: editing.value.lines.filter((l) => l.key !== key) })
  }

  const changeAccount = (key: number, accountId: number | null) =>
    updateLine(key, (line) =>
      applyAccountChange({ line, accountId, accountById, bookkeeperId: editing?.value.householdMemberId ?? null }),
    )

  /** 選べる世帯メンバー。無効なメンバーは、いま選ばれている場合だけ残す */
  const memberOptions = (selectedId: number | null) =>
    (editing?.master.members ?? [])
      .filter((m) => m.isActive || m.id === selectedId)
      .map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))

  const editSideCells = (item: (JournalEditorLine & { side: JournalLineSide | null }) | null, side: JournalLineSide, sideCount: number): ReactNode[] => {
    /** 編集中の行には選択のチェックボックスは出さず、空の列にする */
    const emptyCheck = hasCheck ? [<td key="check" className={`journal-line-table__cell journal-line-table__cell--check ${sideStartClass(side)}`} />] : []
    if (editing === undefined || item === null) {
      return [...emptyCheck, ...SIDE_COLUMNS.map((name, i) => <td key={name} className={cellClass(i, side, hasCheck)} />)]
    }
    const { key, line } = item
    const sideName = SIDE_LABEL[side]
    const master = editing.master
    const account = line.accountId === null ? undefined : accountById.get(line.accountId)
    const defaultMember = account?.householdMemberId == null ? undefined : memberById.get(account.householdMemberId)

    const cells: ReactNode[] = [
      <TreeSelect
        key="account"
        label={`${sideName}の科目`}
        categories={master.accountCategories}
        value={line.accountId === null ? '' : String(line.accountId)}
        placeholder="未選択"
        onChange={(v) => changeAccount(key, v === '' ? null : Number(v))}
        onCreate={
          editing.onRequestCreateAccount === undefined
            ? undefined
            : () => editing.onRequestCreateAccount?.((id) => changeAccount(key, id))
        }
      />,
      <TreeSelect
        key="project"
        label={`${sideName}のプロジェクト`}
        categories={master.projectCategories}
        value={line.projectId === null ? '' : String(line.projectId)}
        emptyLabel="プロジェクトなし"
        placeholder="なし"
        onChange={(v) => updateLine(key, (l) => ({ ...l, projectId: v === '' ? null : Number(v) }))}
        onCreate={
          editing.onRequestCreateProject === undefined
            ? undefined
            : () => editing.onRequestCreateProject?.((id) => updateLine(key, (l) => ({ ...l, projectId: id })))
        }
      />,
      // 取引先(費用・収益の科目)と精算バッチ(システム管理の立替金・未払金)は、どちらか一方しか持てないため1つのセルに出す
      account !== undefined && isCounterpartyEligibleCategory(account.category) ? (
        <TreeSelect
          key="partner"
          label={`${sideName}の取引先`}
          categories={master.counterpartyCategories}
          value={line.counterpartyId === null ? '' : String(line.counterpartyId)}
          emptyLabel="取引先なし"
          placeholder="取引先なし"
          onChange={(v) => updateLine(key, (l) => ({ ...l, counterpartyId: v === '' ? null : Number(v) }))}
          onCreate={
            editing.onRequestCreateCounterparty === undefined
              ? undefined
              : () => editing.onRequestCreateCounterparty?.((id) => updateLine(key, (l) => ({ ...l, counterpartyId: id })))
          }
        />
      ) : account !== undefined && isSettlementBatchTaggableAccount(account) ? (
        <select
          key="partner"
          className="journal-line-table__control"
          aria-label={`${sideName}の精算バッチ`}
          value={line.settlementBatchId == null ? '' : String(line.settlementBatchId)}
          onChange={(e) => updateLine(key, (l) => ({ ...l, settlementBatchId: e.target.value === '' ? null : Number(e.target.value) }))}
        >
          <option value="">精算バッチなし</option>
          {master.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : null,
      defaultMember !== undefined && line.householdMemberId === defaultMember.id ? (
        <span key="member" className="journal-line-table__locked">
          {defaultMember.name}(科目の既定)
        </span>
      ) : (
        <select
          key="member"
          className="journal-line-table__control"
          aria-label={`${sideName}の世帯メンバー`}
          value={line.householdMemberId === null ? '' : String(line.householdMemberId)}
          onChange={(e) => updateLine(key, (l) => ({ ...l, householdMemberId: e.target.value === '' ? null : Number(e.target.value) }))}
        >
          {line.householdMemberId === null && <option value="">選択してください</option>}
          {memberOptions(line.householdMemberId)}
        </select>
      ),
      <span key="amount" className="journal-line-table__amount-edit">
        <input
          className="journal-line-table__control journal-line-table__amount-input"
          inputMode="numeric"
          aria-label={`${sideName}の金額`}
          value={line.amountInput}
          onChange={(e) => updateLine(key, (l) => ({ ...l, amountInput: e.target.value }))}
        />
        <button
          type="button"
          className="journal-line-table__remove"
          aria-label={`${sideName}の行を削除`}
          disabled={sideCount <= 1}
          onClick={() => removeLine(key)}
        >
          ×
        </button>
      </span>,
    ]
    return [
      ...emptyCheck,
      ...cells.map((cell, i) => (
        <td key={SIDE_COLUMNS[i]} className={cellClass(i, side, hasCheck)}>
          {cell}
        </td>
      )),
    ]
  }

  const renderEditBar = (e: JournalLineTableEditing) => {
    const balance = summarizeBalance(e.value.lines.map((l) => l.line))
    return (
      <>
        <tr className="journal-line-table__bar">
          <td colSpan={4} />
          <td colSpan={sideSpan} className="journal-line-table__debit-start">
            <div className="journal-line-table__bar-side">
              <button type="button" className="journal-line-table__small-button" onClick={() => addLine('debit')}>
                + 借方の行
              </button>
              <span className="journal-line-table__total">{`借方合計 ${formatCurrency(balance.debitTotal, 'JPY')}`}</span>
            </div>
          </td>
          <td colSpan={sideSpan} className="journal-line-table__credit-start">
            <div className="journal-line-table__bar-side">
              <button type="button" className="journal-line-table__small-button" onClick={() => addLine('credit')}>
                + 貸方の行
              </button>
              {/* 貸借の一致状況は、貸方合計の左隣に出す */}
              <span className="journal-line-table__balance-total">
                <span
                  role="status"
                  className={`journal-line-table__balance${balance.isBalanced ? '' : ' journal-line-table__balance--off'}`}
                >
                  {balance.isBalanced ? '貸借が一致しています' : `貸借が合っていません(差額 ${formatCurrency(balance.difference, 'JPY')})`}
                </span>
                <span className="journal-line-table__total">{`貸方合計 ${formatCurrency(balance.creditTotal, 'JPY')}`}</span>
              </span>
            </div>
          </td>
        </tr>
        <tr className="journal-line-table__bar journal-line-table__bar--actions">
          <td colSpan={COLUMN_COUNT + (hasCheck ? 2 : 0)}>
            <div className="journal-line-table__actions">
              <span className="journal-line-table__error-slot">
                {e.error !== undefined && e.error !== '' && (
                  <span role="alert" className="journal-line-table__error">
                    {e.error}
                  </span>
                )}
              </span>
              <span className="journal-line-table__buttons">
                {e.deleteArmed ? (
                  <span role="alert" className="journal-line-table__delete-box">
                    <span className="journal-line-table__delete-title">この仕訳を削除します。元に戻せません。</span>
                    {(e.deleteNotes ?? []).map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                    <button type="button" className="journal-line-table__button" onClick={e.onDeleteCancel}>
                      やめる
                    </button>
                    <button
                      type="button"
                      className="journal-line-table__button journal-line-table__button--danger-solid"
                      disabled={e.busy}
                      onClick={e.onDelete}
                    >
                      本当に削除する
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="journal-line-table__button journal-line-table__button--danger"
                    disabled={e.busy}
                    onClick={e.onDelete}
                  >
                    仕訳を削除
                  </button>
                )}
                <button type="button" className="journal-line-table__button" onClick={e.onCancel}>
                  キャンセル
                </button>
                <button
                  type="button"
                  className="journal-line-table__button journal-line-table__button--primary"
                  disabled={e.busy || !balance.isBalanced}
                  onClick={e.onSave}
                >
                  保存
                </button>
              </span>
            </div>
          </td>
        </tr>
      </>
    )
  }

  return (
    <div className="journal-line-table-wrap">
      <div className="journal-line-table__toolbar">
        <button
          type="button"
          className="journal-line-table__small-button"
          disabled={isDefaultColumnWidths(widths)}
          onClick={resetAllColumns}
        >
          列幅を初期値に戻す
        </button>
      </div>
      <div className="journal-line-table">
      <table
        ref={tableRef}
        className="journal-line-table__table"
        aria-label="仕訳の明細行"
        style={{ minWidth: totalTableWidth(widths) + checkColumnsWidth }}
      >
        <colgroup>
          {LEFT_COLUMN_KEYS.map((key) => (
            <col key={key} style={{ width: widths[key] }} />
          ))}
          {[0, 1].flatMap((side) => [
            hasCheck ? <col key={`${side}-check`} style={{ width: CHECK_COLUMN_WIDTH }} /> : null,
            ...SIDE_COLUMN_KEYS.map((key) => <col key={`${side}-${key}`} style={{ width: widths[key] }} />),
          ])}
        </colgroup>
        <thead>
          <tr className="journal-line-table__group-head">
            <td colSpan={4} />
            <th colSpan={sideSpan} scope="colgroup" className="journal-line-table__debit-start">
              借方
            </th>
            <th colSpan={sideSpan} scope="colgroup" className="journal-line-table__credit-start">
              貸方
            </th>
          </tr>
          <tr>
            {LEFT_COLUMNS.map((name, i) => (
              <th key={name} scope="col">
                {name}
                {resizeHandle(LEFT_COLUMN_KEYS[i], name)}
              </th>
            ))}
            {[0, 1].flatMap((side) => {
              const sideName: JournalLineSide = side === 0 ? 'debit' : 'credit'
              return [
                hasCheck ? (
                  <th key={`${side}-check`} scope="col" className={`journal-line-table__cell--check ${sideStartClass(sideName)}`}>
                    {sideHeadCheck(sideName)}
                  </th>
                ) : null,
                ...SIDE_COLUMNS.map((name, i) => (
                  <th
                    key={`${side}-${name}`}
                    scope="col"
                    className={[
                      i === 0 && !hasCheck ? sideStartClass(sideName) : '',
                      name === '金額' ? 'journal-line-table__cell--amount' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {name}
                    {resizeHandle(SIDE_COLUMN_KEYS[i], `${SIDE_LABEL[sideName]}の${name}`)}
                  </th>
                )),
              ]
            })}
          </tr>
        </thead>
        {entries.map((entry) => {
          const tag = SOURCE_TAGS[entry.sourceType]
          const isEditing = editing !== undefined && editing.entryId === entry.id
          const memo = entry.memo !== null && entry.memo !== '' ? entry.memo : '(摘要なし)'
          const selected = entry.id === selectedId

          if (isEditing) {
            const e = editing
            const items = e.value.lines.map((l) => ({ ...l, side: l.line.side }))
            const debitCount = items.filter((l) => l.side === 'debit').length
            const creditCount = items.filter((l) => l.side === 'credit').length
            return (
              <tbody key={entry.id} data-entry-id={entry.id} className="journal-line-table__editing">
                {pairLinesBySide(items).map((pair, index) => (
                  <tr key={index} className="journal-line-table__row--editing">
                    {/* 編集中は出どころのタグを出さず、その列の幅を取引日と摘要の入力欄に回す(日付・出どころ・摘要の3列分を1つのセルにする) */}
                    <td colSpan={3} className="journal-line-table__cell">
                      {index === 0 && (
                        <div className="journal-line-table__edit-head">
                          <input
                            type="date"
                            className="journal-line-table__control journal-line-table__edit-date"
                            aria-label="取引日"
                            value={e.value.entryDate}
                            onChange={(ev) => update({ entryDate: ev.target.value })}
                          />
                          <input
                            className="journal-line-table__control"
                            aria-label="摘要"
                            value={e.value.memo}
                            onChange={(ev) => update({ memo: ev.target.value })}
                          />
                        </div>
                      )}
                    </td>
                    <td className="journal-line-table__cell">
                      {index === 0 && (
                        <input
                          className="journal-line-table__control"
                          aria-label="コメント"
                          value={e.value.comment}
                          onChange={(ev) => update({ comment: ev.target.value })}
                        />
                      )}
                    </td>
                    {editSideCells(pair.debit, 'debit', debitCount)}
                    {editSideCells(pair.credit, 'credit', creditCount)}
                  </tr>
                ))}
                {renderEditBar(e)}
              </tbody>
            )
          }

          return (
            <tbody key={entry.id} data-entry-id={entry.id}>
              {pairLinesBySide(entry.lines).map((pair, index) => (
                <tr
                  key={index}
                  className={selected ? 'journal-line-table__row--selected' : undefined}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(entry.id)}
                >
                  <td className="journal-line-table__cell">{index === 0 ? formatDate(toDate(entry.entryDate)) : ''}</td>
                  <td className="journal-line-table__cell">
                    {index === 0 && (
                      <span className="journal-line-table__tag" style={{ background: tag.bg, color: tag.fg }}>
                        {tag.label}
                      </span>
                    )}
                  </td>
                  <td className="journal-line-table__cell">
                    {/* 行のどこを押しても選べるが、キーボードで選べるよう、摘要はボタンにする */}
                    {index === 0 && (
                      <button type="button" className="journal-line-table__memo">
                        {memo}
                      </button>
                    )}
                  </td>
                  <td className="journal-line-table__cell journal-line-table__comment">{index === 0 ? (entry.comment ?? '') : ''}</td>
                  {viewSideCells(pair.debit, entry.currency, 'debit')}
                  {viewSideCells(pair.credit, entry.currency, 'credit')}
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
      </div>
    </div>
  )
}
