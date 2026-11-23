import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Account } from '../../domain/account/Account'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { listSplittableEntries, type SplittableEntry } from '../../domain/expense-splitting/listSplittableEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalFilterPanel } from '../common/journal-filter/JournalFilterPanel'
import { ListLoadMore } from '../common/list-paging/ListLoadMore'
import { nextDisplayLimit, resolveShownCount } from '../common/list-paging/listPaging'
import { useElementHeight } from '../common/sticky/useElementHeight'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { EntryDetailDialog } from './EntryDetailDialog'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import {
  calculateParticipantAmounts,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from '../expense-splitting/expenseSplittingFormParticipant'
import { runInHistoryGroup } from '../../infrastructure/history/historyGroupRunner'
import { submitExpenseSplit, type SubmitExpenseSplitError } from '../expense-splitting/submitExpenseSplit'
import { BatchSelect } from '../master/BatchSelect'
import { useEscapeToClear } from '../common/range-selection/useEscapeToClear'
import { useRangeSelection } from '../common/range-selection/useRangeSelection'
import type { SplitSettleData, SplitSettleDerived, SplitSettleRepositories } from './splitSettleData'
import { SPLIT_LIST_PAGE_SIZE } from './splitListPaging'
import { buildPartnerCategories, parsePartnerValue, toPartnerValue } from './splitSettleModel'
import { StickyHeaderTable } from '../common/sticky/StickyHeaderTable'
import './SplitSettleScreen.css'

export interface SplitTabProps {
  data: SplitSettleData
  derived: SplitSettleDerived
  repositories: SplitSettleRepositories
  /** 割勘仕訳の取引日(YYYY-MM-DD) */
  today: string
  /** 書き込みのあとにデータを読み直す */
  onChanged: () => Promise<void>
  /** 最初から選んだ状態にする仕訳(仕訳画面の「この仕訳を割勘」から来たとき) */
  initialCheckedEntryIds?: readonly number[]
  /** 絞り込み条件。開閉ボタンがタブの行にあるため、親が持つ(計画Issue #266) */
  filter: JournalEntryFilter
  onFilterChange: (filter: JournalEntryFilter) => void
  /** 絞り込み欄を開いているか。初期は閉 */
  filterOpen: boolean
}

const ERROR_TEXT: Record<SubmitExpenseSplitError, string> = {
  expenseAccountNotFound: '費用の行がある仕訳を選んでください',
  requiredFieldMissing: '未収金(精算バッチ)の科目が見つかりません',
  advanceLiabilityAccountRequired: '未払金の科目が見つかりません',
  counterpartyTargetRequired: '分担相手を選んでください',
  noRecipient: '相手の負担額が0円です。割合や金額を確認してください',
}

/** 割勘タブのバッチの先頭に固定する「新しいバッチを作成」(記録するときにバッチを作る既定の選択状態)。参照を安定させるため定数にする */
const NEW_BATCH_OPTIONS = [{ value: 'new', label: '新しいバッチを作成' }]

const MODE_LABEL: Record<ExpenseSplittingAllocationMode, string> = {
  ratio: '割合で分ける',
  equal: '均等に分ける',
  amount: '金額を指定する',
}

/** 割勘する仕訳の既定の摘要。精算バッチを新規作成するときの名前にもなる(精算タブで変更できる) */
function defaultMemo(entries: readonly SplittableEntry[]): string {
  if (entries.length === 1) {
    const memo = entries[0].entry.memo
    return memo === null || memo === '' ? '割勘' : `${memo}の割勘`
  }
  return `${entries.length}件の支出の割勘`
}

function payerAccountName(item: SplittableEntry, accounts: readonly Account[]): string {
  const other = item.entry.lines.find((l) => !item.expenseLines.includes(l))
  return accounts.find((a) => a.id === other?.accountId)?.name ?? ''
}

/**
 * 割勘タブ(計画Issue #153、承認済みモックアップ)。絞り込み欄はタブの行のボタンで開閉し(初期は閉、計画Issue #266)、割勘できる仕訳だけを
 * 候補に出す(割勘で作られた仕訳・割勘済みの仕訳・借方に費用の行がない仕訳は出ない)。
 * 仕訳を選び、分担相手(世帯メンバーと取引先をグループつきで選ぶ)と負担の割合で割勘を記録する。
 * 絞り込みで隠れた行も、チェック済みなら合計に含める。按分は割合のほか、均等・金額指定を選べる
 * (金額指定は仕訳を1件だけ選んだときのみ)。精算バッチは新規作成(既定)か既存から選ぶ。
 * 割勘仕訳の摘要は入力でき、空のときは既定の摘要を使う(新しい精算バッチを作るときは、その摘要がバッチ名になる)。
 * 候補は150件ずつ「さらにN件表示」で出し、チェック済みの仕訳が150件の外にあるときは、その仕訳が見える件数まで広げる
 * (合計に含まれる仕訳が見えなくならないため、計画Issue #268)。割勘履歴は履歴タブ(SplitHistoryTab)にある。
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
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<number>>(() => new Set(initialCheckedEntryIds))
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

  const relatedIds = useMemo(() => buildRelatedEntryIdsByEntryId(data.memberships), [data.memberships])
  const candidates = useMemo(
    () => listSplittableEntries(data.entries, data.accounts, relatedIds),
    [data.entries, data.accounts, relatedIds],
  )
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
  /** 表に出す件数。上限までだが、チェック済みの仕訳(絞り込みで隠れたものは数えない)が範囲の外にあるときは、いちばん後ろの仕訳が見えるまで広げる */
  const lastCheckedIndex = shown.reduce((last, item, index) => (checkedIds.has(item.entry.id) ? index : last), -1)
  const shownCount = resolveShownCount({
    total: shown.length,
    limit: displayLimit,
    pageSize: SPLIT_LIST_PAGE_SIZE.candidate,
    selectedIndex: lastCheckedIndex,
  })
  const visible = useMemo(() => shown.slice(0, shownCount), [shown, shownCount])
  const chosen = candidates.filter((c) => checkedIds.has(c.entry.id))
  const total = chosen.reduce((sum, c) => sum + c.amount, 0)
  const payerIds = new Set(chosen.map((c) => c.entry.householdMemberId))

  const partnerCategories = useMemo(
    () => buildPartnerCategories(data.members, derived.counterpartyCategories, payerIds),
    // payerIdsは選んだ仕訳から毎回作る集合なので、中身の文字列で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.members, derived.counterpartyCategories, [...payerIds].sort().join(',')],
  )

  // 相手ごとの負担額。均等・割合は費用の行ごとに計算して足す(送信時と同じ計算)
  const shareByKey = new Map<number, number>()
  for (const row of partners) {
    if (mode === 'amount') {
      shareByKey.set(row.key, Number(row.amountInput) || 0)
      continue
    }
    let sum = 0
    for (const c of chosen) {
      for (const expenseLine of c.expenseLines) {
        sum += calculateParticipantAmounts(expenseLine.amount, partners, mode).get(String(row.key)) ?? 0
      }
    }
    shareByKey.set(row.key, sum)
  }
  const totalShare = [...shareByKey.values()].reduce((sum, n) => sum + n, 0)

  const patchPartner = (key: number, changes: Partial<ExpenseSplittingParticipantRow>) => {
    setPartners((prev) => prev.map((p) => (p.key === key ? { ...p, ...changes } : p)))
    setFlash('')
    setError('')
  }

  // 仕訳のチェックの Shift+クリック(範囲選択)・Ctrl/Cmd+クリック(トグル)・Shift+↑↓、Ctrl/Cmd+行のどこかを押す操作(計画Issue #235 D)
  const range = useRangeSelection<number>({
    order: visible.map((item) => item.entry.id),
    selected: [...checkedIds],
    onChange: (next) => {
      setCheckedIds(new Set(next))
      setFlash('')
      setError('')
    },
  })
  // Esc で仕訳のチェックをすべて外す
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
          originalEntries: chosen.map((c) => c.entry),
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

  const partnerName = (row: ExpenseSplittingParticipantRow) => {
    if (row.targetId === null) return '未選択'
    if (row.kind === 'householdMember') return data.members.find((m) => m.id === row.targetId)?.name ?? '未選択'
    return data.counterparties.find((c) => c.id === row.targetId)?.name ?? '未選択'
  }

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

      {/* 右のパネルは、固定したタブの行と絞り込み欄の下に追従する(絞り込み欄の高さを --sticky-head-extra で渡す、計画Issue #266) */}
      <div className="split-settle__body" style={{ '--sticky-head-extra': `${filterHeight}px` } as CSSProperties}>
        <section aria-label="割勘する仕訳" className="split-settle__card split-settle__card--table">
          <p className="split-settle__note split-settle__note--pad">
            費用の行があり、まだ割勘していない仕訳だけを表示しています。費用の行が複数あれば、各行を同じ割合で割ります。
          </p>
          <StickyHeaderTable
            frameClassName="split-settle__scroll"
            tableClassName="split-settle__table"
            floatingClassName="floating-table-header--bare"
            head={
              <thead>
                <tr>
                  <th>選択</th>
                  <th>日付</th>
                  <th>摘要</th>
                  <th>支払元</th>
                  <th className="split-settle__num">金額</th>
                </tr>
              </thead>
            }
          >
            <tbody>
              {visible.map((item) => {
                const memo = item.entry.memo ?? ''
                return (
                  <tr key={item.entry.id} {...range.selectingRowProps(item.entry.id)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${memo}を選択`}
                        checked={checkedIds.has(item.entry.id)}
                        {...range.checkboxProps(item.entry.id)}
                      />
                    </td>
                    <td className="split-settle__nowrap">{item.entry.entryDate}</td>
                    <td>
                      <button type="button" className="split-settle__link" onClick={() => setDetailEntryId(item.entry.id)}>
                        {memo === '' ? '(摘要なし)' : memo}
                      </button>
                    </td>
                    <td>{payerAccountName(item, data.accounts)}</td>
                    <td className="split-settle__num">{formatCurrency(item.amount, 'JPY')}</td>
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

        <section aria-label="分担" className="split-settle__card split-settle__side">
          <h2 className="split-settle__h2">分担</h2>
          <div className="split-settle__line">
            <span>選択した合計</span>
            <span className="split-settle__num">{formatCurrency(total, 'JPY')}</span>
          </div>

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
                <option key={m} value={m} disabled={m === 'amount' && chosen.length > 1}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
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
          {error !== '' && (
            <p role="alert" className="split-settle__error">
              {error}
            </p>
          )}
          {flash !== '' && <span className="split-settle__flash">{flash}</span>}
        </section>
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
