import { useMemo, useRef, useState } from 'react'
import type { Account } from '../../domain/account/Account'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { listSplittableEntries, type SplittableEntry } from '../../domain/expense-splitting/listSplittableEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalFilterPanel } from '../common/journal-filter/JournalFilterPanel'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { EntryDetailDialog } from './EntryDetailDialog'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import {
  calculateParticipantAmounts,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from '../expense-splitting/expenseSplittingFormParticipant'
import { submitExpenseSplit, type SubmitExpenseSplitError } from '../expense-splitting/submitExpenseSplit'
import type { SplitSettleData, SplitSettleDerived, SplitSettleRepositories } from './splitSettleData'
import {
  buildPartnerCategories,
  buildSplitHistoryRows,
  parsePartnerValue,
  toPartnerValue,
} from './splitSettleModel'
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
}

const ERROR_TEXT: Record<SubmitExpenseSplitError, string> = {
  expenseAccountNotFound: '費用の行がある仕訳を選んでください',
  requiredFieldMissing: '立替金の科目が見つかりません',
  advanceLiabilityAccountRequired: '未払金の科目が見つかりません',
  counterpartyTargetRequired: '分担相手を選んでください',
  noRecipient: '相手の負担額が0円です。割合や金額を確認してください',
}

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
 * 割勘タブ(計画Issue #153、承認済みモックアップ)。絞り込みを常に表示し、割勘できる仕訳だけを
 * 候補に出す(割勘で作られた仕訳・割勘済みの仕訳・借方に費用の行がない仕訳は出ない)。
 * 仕訳を選び、分担相手(世帯メンバーと取引先をグループつきで選ぶ)と負担の割合で割勘を記録する。
 * 絞り込みで隠れた行も、チェック済みなら合計に含める。按分は割合のほか、均等・金額指定を選べる
 * (金額指定は仕訳を1件だけ選んだときのみ)。精算バッチは新規作成(既定)か既存から選ぶ。
 * 割勘仕訳の摘要は入力でき、空のときは既定の摘要を使う(新しい精算バッチを作るときは、その摘要がバッチ名になる)。
 * 下に割勘履歴を出し、精算が進んでいない割勘は2回押して取り消せる。
 */
export function SplitTab({
  data,
  derived,
  repositories,
  today,
  onChanged,
  initialCheckedEntryIds = [],
}: SplitTabProps) {
  const [filter, setFilter] = useState<JournalEntryFilter>({})
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
  const [confirmingCancelId, setConfirmingCancelId] = useState<number | null>(null)
  const [createForRowKey, setCreateForRowKey] = useState<number | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'open' | 'settled'>('open')
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

  const toggle = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFlash('')
    setError('')
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
      const result = await submitExpenseSplit({
        originalEntries: chosen.map((c) => c.entry),
        accounts: data.accounts,
        settlementBatches: data.batches,
        participants: partners,
        allocationMode: mode,
        memo: memoInput.trim() === '' ? defaultMemo(chosen) : memoInput.trim(),
        settlementBatchId: batchId,
        today,
        repositories,
      })
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

  const historyRows = useMemo(
    () => buildSplitHistoryRows(data.entries, data.accounts, relatedIds, data.members, data.counterparties),
    [data.entries, data.accounts, relatedIds, data.members, data.counterparties],
  )

  const openCount = historyRows.filter((r) => !r.isSettled).length
  const settledCount = historyRows.length - openCount
  const shownHistory = historyRows.filter((r) => r.isSettled === (historyStatus === 'settled'))
  const detailEntry = data.entries.find((e) => e.id === detailEntryId)

  const cancelSplit = async (splitEntryId: number) => {
    setConfirmingCancelId(null)
    const splitEntry = data.entries.find((e) => e.id === splitEntryId)
    await repositories.journalEntryRepository.delete(splitEntryId)
    // 取り消した結果、紐づく仕訳が0件になった精算バッチは残さずに削除する
    const batchIds = new Set(
      (splitEntry?.lines ?? []).flatMap((l) => (l.settlementBatchId === null ? [] : [l.settlementBatchId])),
    )
    for (const batchId of batchIds) {
      const stillUsed = data.entries.some(
        (e) => e.id !== splitEntryId && e.lines.some((l) => l.settlementBatchId === batchId),
      )
      if (!stillUsed) await repositories.settlementBatchRepository.delete(batchId)
    }
    await onChanged()
  }

  const partnerName = (row: ExpenseSplittingParticipantRow) => {
    if (row.targetId === null) return '未選択'
    if (row.kind === 'householdMember') return data.members.find((m) => m.id === row.targetId)?.name ?? '未選択'
    return data.counterparties.find((c) => c.id === row.targetId)?.name ?? '未選択'
  }

  return (
    <>
      <div className="split-settle__filter">
        <JournalFilterPanel
          filter={filter}
          onChange={setFilter}
          options={derived.filterOptions}
          resultCount={shown.length}
        />
      </div>

      <div className="split-settle__body">
        <section aria-label="割勘する仕訳" className="split-settle__card split-settle__card--table">
          <p className="split-settle__note split-settle__note--pad">
            費用の行があり、まだ割勘していない仕訳だけを表示しています。費用の行が複数あれば、各行を同じ割合で割ります。
          </p>
          <table className="split-settle__table">
            <thead>
              <tr>
                <th>選択</th>
                <th>日付</th>
                <th>摘要</th>
                <th>支払元</th>
                <th className="split-settle__num">金額</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const memo = item.entry.memo ?? ''
                return (
                  <tr key={item.entry.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${memo}を選択`}
                        checked={checkedIds.has(item.entry.id)}
                        onChange={() => toggle(item.entry.id)}
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
          </table>
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
            <label className="split-settle__label" htmlFor="split-batch">
              精算バッチ
            </label>
            <select
              id="split-batch"
              className="split-settle__control"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
            >
              <option value="new">新しいバッチを作成</option>
              {data.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
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

      <section aria-label="割勘履歴" className="split-settle__card split-settle__card--table">
        <div className="split-settle__history-head">
          <h2 className="split-settle__h2">過去の割勘</h2>
          <div role="group" aria-label="精算状況で絞り込む" className="split-settle__filters">
            {(
              [
                { key: 'open', label: '未精算', count: openCount },
                { key: 'settled', label: '精算済み', count: settledCount },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={historyStatus === item.key}
                className={`split-settle__btn split-settle__btn--small${historyStatus === item.key ? ' split-settle__btn--pressed' : ''}`}
                onClick={() => {
                  setHistoryStatus(item.key)
                  setConfirmingCancelId(null)
                }}
              >
                {item.label} {item.count}
              </button>
            ))}
          </div>
        </div>
        {shownHistory.length === 0 && (
          <p className="split-settle__empty">
            {historyStatus === 'open' ? '未精算の割勘はありません' : '精算済みの割勘はありません'}
          </p>
        )}
        <table className="split-settle__table">
          <thead>
            <tr>
              <th>日付</th>
              <th>摘要</th>
              <th>相手</th>
              <th className="split-settle__num">相手の負担額</th>
              <th>状態</th>
              <th>取り消し</th>
            </tr>
          </thead>
          <tbody>
            {shownHistory.map((row) => (
              <tr key={row.splitEntryId}>
                <td className="split-settle__nowrap">{row.date}</td>
                <td>
                  <button type="button" className="split-settle__link" onClick={() => setDetailEntryId(row.splitEntryId)}>
                    {row.memo === '' ? '(摘要なし)' : row.memo}
                  </button>
                </td>
                <td>{row.partner}</td>
                <td className="split-settle__num">{formatCurrency(row.amount, 'JPY')}</td>
                <td>{row.isSettled ? '精算済み' : '未精算'}</td>
                <td>
                  {!row.canCancel ? (
                    <span className="split-settle__note">精算が進んでいるため取り消せません</span>
                  ) : confirmingCancelId === row.splitEntryId ? (
                    <span className="split-settle__confirm">
                      <button
                        type="button"
                        className="split-settle__btn split-settle__btn--small"
                        onClick={() => setConfirmingCancelId(null)}
                      >
                        やめる
                      </button>
                      <button
                        type="button"
                        className="split-settle__btn split-settle__btn--small split-settle__btn--danger"
                        onClick={() => void cancelSplit(row.splitEntryId)}
                      >
                        本当に取り消す
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="split-settle__btn split-settle__btn--small"
                      onClick={() => setConfirmingCancelId(row.splitEntryId)}
                    >
                      この割勘を取り消す
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
