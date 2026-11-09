import { useEffect, useMemo, useRef, useState } from 'react'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import {
  findUnassignedAdvanceEntriesForTarget,
  type UnassignedAdvanceEntryCandidate,
} from '../../domain/settlement/findUnassignedAdvanceEntriesForTarget'
import { resolveSettlementAdjustment } from '../../domain/settlement/resolveSettlementAdjustment'
import { planSettlementBatchDeletion } from '../../domain/settlement-batch/planSettlementBatchDeletion'
import { resolveSettlementTarget } from '../../domain/settlement-batch/resolveSettlementTarget'
import {
  summarizeSettlementBatch,
  type SettlementBatchSummary,
  type SettlementDirection,
} from '../../domain/settlement-batch/summarizeSettlementBatch'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalFilterPopup } from '../common/journal-filter/JournalFilterPopup'
import { countActiveConditions } from '../common/journal-filter/journalFilterModel'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { SplitSettleData, SplitSettleDerived, SplitSettleRepositories } from './splitSettleData'
import { EntryDetailDialog } from './EntryDetailDialog'
import { createSettlementEntry, tagCandidatesToBatch } from './submitSettlement'
import './SplitSettleScreen.css'

/** 差額損益計上先の科目名(infrastructure/db/seedSettlementAdjustmentAccounts.tsの同名の定数と一致させる) */
const GAIN_ACCOUNT_NAME = '雑収入'
const LOSS_ACCOUNT_NAME = '雑損失'

type StatusFilter = 'open' | 'settled' | 'all'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'open', label: '未精算' },
  { key: 'settled', label: '精算済み' },
  { key: 'all', label: 'すべて' },
]

const DIRECTIONS: { key: SettlementDirection; label: string; sub: string }[] = [
  { key: 'advance', label: '立替金を減らす', sub: '相手から受け取る' },
  { key: 'payable', label: '未払金を減らす', sub: '相手へ支払う' },
]

export interface SettleTabProps {
  data: SplitSettleData
  derived: SplitSettleDerived
  repositories: SplitSettleRepositories
  /** 精算の仕訳の取引日の既定値(YYYY-MM-DD) */
  today: string
  /** 書き込みのあとにデータを読み直す */
  onChanged: () => Promise<void>
}

const matchesStatus = (summary: SettlementBatchSummary, key: StatusFilter) =>
  key === 'all' || (key === 'settled' ? summary.isSettled : !summary.isSettled)

const signed = (amount: number) => (amount > 0 ? `+${formatCurrency(amount, 'JPY')}` : formatCurrency(amount, 'JPY'))

/**
 * 精算タブ(計画Issue #153、承認済みモックアップ)。精算バッチを先に選び、一覧に立替金と未払金の
 * 残高を別々に出す(合算も相殺もしない)。「未精算」「精算済み」「すべて」で切り替え、精算済みは
 * 履歴として見られる(精算済みは、バッチの残高が0かどうかだけで判定する)。選んだバッチの
 * 「立替金を減らす」「未払金を減らす」の2枚のカードで方向を切り替え、方向の残高と、選んだ仕訳の
 * 合計を比べる。一致すれば精算完了、不一致なら未精算として残すか、差額を雑収入・雑損失に計上して
 * 完了するかを選ぶ(docs/domain/settlement.md 1.9)。候補の有無によらず、精算の仕訳を起票できる。
 * バッチ名と世帯外の相手(取引先)も編集できる。
 */
export function SettleTab({ data, derived, repositories, today, onChanged }: SettleTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [directionOverride, setDirectionOverride] = useState<SettlementDirection | null>(null)
  const [filter, setFilter] = useState<JournalEntryFilter>({})
  const [checkedLineIds, setCheckedLineIds] = useState<ReadonlySet<number>>(new Set())
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftDate, setDraftDate] = useState(today)
  const [draftAccount, setDraftAccount] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const allLines = useMemo(() => data.entries.flatMap((e) => e.lines), [data.entries])
  const summaries = useMemo(
    () => data.batches.map((b) => summarizeSettlementBatch(b, allLines, data.accounts)),
    [data.batches, allLines, data.accounts],
  )
  const listed = summaries.filter((s) => matchesStatus(s, statusFilter))
  const summary = summaries.find((s) => s.batch.id === selectedId) ?? listed[0] ?? summaries[0] ?? null

  // 精算して残高が0になったバッチは、精算済みの一覧に移して、そのまま選んだままにする
  const effectiveId = summary?.batch.id ?? null
  const wasSettled = useRef<{ id: number; settled: boolean } | null>(null)
  useEffect(() => {
    if (summary === null) return
    if (selectedId === null) setSelectedId(summary.batch.id)
    const before = wasSettled.current
    if (before !== null && before.id === summary.batch.id && !before.settled && summary.isSettled) {
      setStatusFilter((current) => (current === 'open' ? 'settled' : current))
    }
    wasSettled.current = { id: summary.batch.id, settled: summary.isSettled }
  }, [effectiveId, summary?.isSettled]) // eslint-disable-line react-hooks/exhaustive-deps

  const memberName = (id: number | null) => data.members.find((m) => m.id === id)?.name ?? ''
  const counterpartyName = (id: number | null) => data.counterparties.find((c) => c.id === id)?.name ?? ''

  const resetWorking = () => {
    setDirectionOverride(null)
    setFilter({})
    setCheckedLineIds(new Set())
    setDraftOpen(false)
    setConfirmingDelete(false)
    setDraftAmount('')
    setFlash('')
    setError('')
  }

  if (summary === null) {
    return <p className="split-settle__note">精算バッチはまだありません。割勘を記録すると作られます。</p>
  }

  const batch = summary.batch
  const primaryDirection: SettlementDirection =
    (['advance', 'payable'] as const).find((d) => (summary[d]?.balance ?? 0) !== 0) ??
    (['advance', 'payable'] as const).find((d) => summary[d]?.hasLines) ??
    'advance'
  const direction = directionOverride ?? primaryDirection
  const directionSummary = summary[direction]
  const resolved = resolveSettlementTarget(summary, direction)
  const side = direction === 'advance' ? 'credit' : 'debit'
  const category = direction === 'advance' ? 'asset' : 'liability'

  const candidates: UnassignedAdvanceEntryCandidate[] =
    resolved.target !== null && directionSummary !== null
      ? findUnassignedAdvanceEntriesForTarget(
          data.entries,
          directionSummary.accountId,
          resolved.target,
          { filter, accounts: data.accounts, context: derived.filterContext },
          side,
        )
      : []
  const chosen = candidates.filter((c) => checkedLineIds.has(c.lineId))
  const total = chosen.reduce((sum, c) => sum + c.amount, 0)
  const diff = total - resolved.balance
  const matched = total > 0 && diff === 0
  const mismatched = total > 0 && diff !== 0

  const accountIdByName = (name: string) => data.accounts.find((a) => a.name === name)?.id ?? null
  const gainId = accountIdByName(GAIN_ACCOUNT_NAME)
  const lossId = accountIdByName(LOSS_ACCOUNT_NAME)
  const adjustAccountName = mismatched
    ? resolveSettlementAdjustment(diff, category).isGain
      ? GAIN_ACCOUNT_NAME
      : LOSS_ACCOUNT_NAME
    : ''

  const taggedEntries = data.entries.filter((e) => e.lines.some((l) => l.settlementBatchId === batch.id))
  const detailEntry = data.entries.find((e) => e.id === detailEntryId)
  const taggedEntryIds = taggedEntries.map((e) => e.id)
  const entryHouseholdMemberId =
    (resolved.target?.kind === 'householdMember' ? resolved.target.householdMemberId : null) ?? data.members[0]?.id ?? null

  const run = async (action: () => Promise<void>, done: string) => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await action()
      resetWorking()
      await onChanged()
      setFlash(done)
    } catch {
      setError('精算を記録できませんでした')
    } finally {
      setSubmitting(false)
    }
  }

  const settle = (createAdjustment: boolean) => {
    if (resolved.target === null || directionSummary === null || entryHouseholdMemberId === null) return
    if (createAdjustment && (gainId === null || lossId === null)) {
      setError('差額を計上する科目(雑収入・雑損失)が見つかりません')
      return
    }
    void run(
      () =>
        tagCandidatesToBatch({
          batchId: batch.id,
          taggedEntryIds,
          direction,
          accountId: directionSummary.accountId,
          target: resolved.target!,
          entryHouseholdMemberId,
          repositories,
          candidates: chosen,
          diff,
          createAdjustment,
          adjustmentAccountIds: { gain: gainId ?? 0, loss: lossId ?? 0 },
          today,
        }),
      createAdjustment && mismatched
        ? `差額を${adjustAccountName}に計上して精算しました`
        : createAdjustment || matched
          ? '精算が完了しました'
          : '選択した仕訳をバッチに割り当てました',
    )
  }

  const deletion = planSettlementBatchDeletion(batch.id, data.entries)

  // 割勘仕訳を消してから、最後にバッチを消す(紐づく明細があるバッチはDBが削除を拒否するため)
  const deleteBatch = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      for (const id of deletion.splitEntryIds) await repositories.journalEntryRepository.delete(id)
      await repositories.settlementBatchRepository.delete(batch.id)
      resetWorking()
      setSelectedId(null)
      await onChanged()
    } catch {
      setConfirmingDelete(false)
      setError('精算バッチを削除できませんでした。画面を読み直して、残りを確認してください')
      await onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  const createDraft = () => {
    const amount = Number(draftAmount)
    if (!(amount > 0) || draftAccount === '') {
      setError('相手科目と金額を入力してください')
      return
    }
    if (resolved.target === null || directionSummary === null || entryHouseholdMemberId === null) return
    void run(async () => {
      await createSettlementEntry({
        batchId: batch.id,
        taggedEntryIds,
        direction,
        accountId: directionSummary.accountId,
        target: resolved.target!,
        entryHouseholdMemberId,
        repositories,
        counterAccountId: Number(draftAccount),
        amount,
        entryDate: draftDate,
        memo: `${batch.name} 精算`,
      })
    }, '仕訳を起票してバッチに紐付けました')
  }

  const breakdownText = (d: SettlementDirection) => {
    const s = summary[d]
    if (s === null || !s.hasLines) return '明細なし'
    return s.breakdown
      .map((b) => `${b.householdMemberId === null ? counterpartyName(batch.counterpartyId) || '対象者なし' : memberName(b.householdMemberId)} ${formatCurrency(b.balance, 'JPY')}`)
      .join(' / ')
  }

  const candidateSummary = `候補 ${candidates.length}件`

  return (
    <div className="split-settle__body">
      <section aria-label="精算バッチ一覧" className="split-settle__card split-settle__list">
        <div className="split-settle__list-head">
          <h2 className="split-settle__h2">精算バッチ</h2>
        </div>
        <div role="group" aria-label="精算状況で絞り込む" className="split-settle__filters">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={statusFilter === item.key}
              className={`split-settle__btn split-settle__btn--small${statusFilter === item.key ? ' split-settle__btn--pressed' : ''}`}
              onClick={() => {
                setStatusFilter(item.key)
                const first = summaries.find((s) => matchesStatus(s, item.key))
                if (first !== undefined) setSelectedId(first.batch.id)
                resetWorking()
              }}
            >
              {item.label} {summaries.filter((s) => matchesStatus(s, item.key)).length}
            </button>
          ))}
        </div>
        <table className="split-settle__table">
          <thead>
            <tr>
              <th>バッチ名</th>
              <th className="split-settle__num">立替金</th>
              <th className="split-settle__num">未払金</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((s) => (
              <tr key={s.batch.id} className={s.batch.id === batch.id ? 'split-settle__row--current' : undefined}>
                <td>
                  <button
                    type="button"
                    className="split-settle__link"
                    aria-current={s.batch.id === batch.id}
                    onClick={() => {
                      setSelectedId(s.batch.id)
                      resetWorking()
                    }}
                  >
                    {s.batch.name}
                  </button>
                  <div className="split-settle__note">
                    {counterpartyName(s.batch.counterpartyId) || '世帯内'}
                  </div>
                </td>
                <td className="split-settle__num">
                  {s.advance?.hasLines ? formatCurrency(s.advance.balance, 'JPY') : '-'}
                </td>
                <td className="split-settle__num">
                  {s.payable?.hasLines ? formatCurrency(s.payable.balance, 'JPY') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="選択中の精算バッチ" className="split-settle__card split-settle__panel">
        <div className="split-settle__fields">
          <BatchNameField
            key={batch.id}
            name={batch.name}
            onCommit={(name) =>
              void run(async () => {
                await repositories.settlementBatchRepository.update(batch.id, { name })
              }, 'バッチ名を変更しました')
            }
          />
          <div className="split-settle__field split-settle__field--grow">
            <span className="split-settle__label">世帯外の相手</span>
            <TreeSelect
              label="世帯外の相手"
              categories={derived.counterpartyCategories}
              value={batch.counterpartyId === null ? '' : String(batch.counterpartyId)}
              emptyLabel="なし(世帯内)"
              placeholder="なし(世帯内)"
              onChange={(value) =>
                void run(async () => {
                  await repositories.settlementBatchRepository.update(batch.id, {
                    counterpartyId: value === '' ? null : Number(value),
                  })
                }, '世帯外の相手を変更しました')
              }
            />
          </div>
        </div>

        <div role="group" aria-label="精算の方向" className="split-settle__directions">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              className="split-settle__direction"
              aria-pressed={direction === d.key}
              onClick={() => {
                setDirectionOverride(d.key)
                setCheckedLineIds(new Set())
                setFlash('')
                setError('')
              }}
            >
              <span className="split-settle__direction-label">{d.label}</span>
              <span className="split-settle__direction-sub">{d.sub}</span>
              <span className="split-settle__direction-amount split-settle__num">
                {formatCurrency(summary[d.key]?.balance ?? 0, 'JPY')}
              </span>
              <span className="split-settle__direction-sub">{breakdownText(d.key)}</span>
            </button>
          ))}
        </div>

        {!summary.hasLines && <p className="split-settle__note">このバッチが付いた明細はまだありません。</p>}
        {summary.isSettled && (
          <p className="split-settle__settled">精算済みです。立替金と未払金の残高はどちらも0です。</p>
        )}

        {!summary.isSettled && (
          <div className="split-settle__section">
            <h3 className="split-settle__h3">精算する仕訳を探す</h3>
            <div className="split-settle__popup-row">
              <JournalFilterPopup
                filter={filter}
                onChange={(next) => {
                  setFilter(next)
                  setCheckedLineIds(new Set())
                }}
                options={derived.filterOptions}
                resultCount={candidates.length}
                hide={['batch']}
              />
              <span className="split-settle__note">
                {countActiveConditions(filter) > 0 ? '条件あり / ' : ''}
                {candidateSummary}
              </span>
            </div>

            {candidates.length === 0 ? (
              <p className="split-settle__note">
                条件に合う未割当の仕訳はありません。条件を変えるか、仕訳を起票してください。
              </p>
            ) : (
              <div className="split-settle__scroll">
                <table className="split-settle__table" aria-label="精算の候補">
                  <thead>
                    <tr>
                      <th>選択</th>
                      <th>日付</th>
                      <th>摘要</th>
                      <th>相手科目</th>
                      <th className="split-settle__num">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const memo = c.entry.memo ?? ''
                      const counter = c.entry.lines.find((l) => l.id !== c.lineId)
                      return (
                        <tr key={c.lineId}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${memo}を選択`}
                              checked={checkedLineIds.has(c.lineId)}
                              onChange={() => {
                                setCheckedLineIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(c.lineId)) next.delete(c.lineId)
                                  else next.add(c.lineId)
                                  return next
                                })
                                setFlash('')
                              }}
                            />
                          </td>
                          <td className="split-settle__nowrap">{c.entry.entryDate}</td>
                          <td>{memo}</td>
                          <td>{data.accounts.find((a) => a.id === counter?.accountId)?.name ?? ''}</td>
                          <td className="split-settle__num">{formatCurrency(c.amount, 'JPY')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="split-settle__summary">
              <span>
                選択合計 <span className="split-settle__num">{formatCurrency(total, 'JPY')}</span>
              </span>
              <span className={mismatched ? 'split-settle__diff--warn' : undefined}>
                {total === 0
                  ? `残高 ${formatCurrency(resolved.balance, 'JPY')}`
                  : matched
                    ? '✓ 残高と一致しています'
                    : `差額 ${signed(diff)}(残高 ${formatCurrency(resolved.balance, 'JPY')})`}
              </span>
              <span className="split-settle__spacer" />
              {mismatched && (
                <button
                  type="button"
                  className="split-settle__btn"
                  disabled={submitting}
                  onClick={() => settle(false)}
                >
                  未精算として残す
                </button>
              )}
              {total > 0 && (
                <button
                  type="button"
                  className="split-settle__btn split-settle__btn--primary"
                  disabled={submitting}
                  onClick={() => settle(true)}
                >
                  精算完了
                </button>
              )}
            </div>
            {mismatched && (
              <p className="split-settle__note">
                「精算完了」を選ぶと、差額を{adjustAccountName}に計上してバッチの残高を0にします。
              </p>
            )}
            {error !== '' && (
              <p role="alert" className="split-settle__error">
                {error}
              </p>
            )}
            {flash !== '' && <span className="split-settle__flash">{flash}</span>}

            <button
              type="button"
              className="split-settle__add"
              aria-expanded={draftOpen}
              onClick={() => {
                setDraftOpen((open) => !open)
                if (!draftOpen && draftAmount === '') setDraftAmount(String(Math.max(resolved.balance, 0)))
              }}
            >
              + 精算の仕訳を起票
            </button>
            {draftOpen && (
              <div className="split-settle__draft">
                <div className="split-settle__field split-settle__field--date">
                  <label className="split-settle__label" htmlFor="settle-draft-date">
                    取引日
                  </label>
                  <input
                    id="settle-draft-date"
                    className="split-settle__control"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                  />
                </div>
                <div className="split-settle__field split-settle__field--grow">
                  <span className="split-settle__label">相手科目</span>
                  <TreeSelect
                    label="相手科目"
                    categories={derived.accountCategories}
                    value={draftAccount}
                    onChange={setDraftAccount}
                    placeholder="科目を選ぶ"
                  />
                </div>
                <div className="split-settle__field split-settle__field--amount">
                  <label className="split-settle__label" htmlFor="settle-draft-amount">
                    金額
                  </label>
                  <input
                    id="settle-draft-amount"
                    className="split-settle__control split-settle__control--right"
                    inputMode="numeric"
                    value={draftAmount}
                    onChange={(e) => setDraftAmount(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="split-settle__btn split-settle__btn--primary"
                  disabled={submitting}
                  onClick={createDraft}
                >
                  起票してバッチに紐付け
                </button>
              </div>
            )}
          </div>
        )}

        {!summary.isSettled && (
          <div className="split-settle__section">
            <h3 className="split-settle__h3">バッチの削除</h3>
            {!deletion.deletable ? (
              <>
                <p className="split-settle__note">
                  精算が進んでいる(精算で紐づけた仕訳がある)ため、削除できません。
                </p>
                <button type="button" className="split-settle__btn split-settle__btn--small" disabled>
                  このバッチを削除
                </button>
              </>
            ) : confirmingDelete ? (
              <>
                <p className="split-settle__note">
                  割勘仕訳{deletion.splitEntryIds.length}件とこのバッチを削除します。元の仕訳は削除しません。
                </p>
                <span className="split-settle__confirm">
                  <button
                    type="button"
                    className="split-settle__btn split-settle__btn--small"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    className="split-settle__btn split-settle__btn--small split-settle__btn--danger"
                    disabled={submitting}
                    onClick={() => void deleteBatch()}
                  >
                    本当に削除する
                  </button>
                </span>
              </>
            ) : (
              <button
                type="button"
                className="split-settle__btn split-settle__btn--small"
                onClick={() => setConfirmingDelete(true)}
              >
                このバッチを削除
              </button>
            )}
          </div>
        )}

        <div className="split-settle__section">
          <h3 className="split-settle__h3">このバッチの仕訳</h3>
          {taggedEntries.flatMap((entry) =>
            entry.lines
              .filter((l) => l.settlementBatchId === batch.id)
              .map((l) => (
                <div key={l.id} className="split-settle__tagged">
                  <button
                    type="button"
                    className="split-settle__link split-settle__link--grow"
                    onClick={() => setDetailEntryId(entry.id)}
                  >
                    {entry.entryDate} {entry.memo ?? ''}
                  </button>
                  <span className="split-settle__note">
                    {l.side === 'debit' ? '借方' : '貸方'} {data.accounts.find((a) => a.id === l.accountId)?.name ?? ''}
                  </span>
                  <span className="split-settle__num">{formatCurrency(l.amount, 'JPY')}</span>
                </div>
              )),
          )}
        </div>
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
    </div>
  )
}

/** バッチ名の入力。確定(フォーカスを外す)したときだけ保存する。バッチを切り替えると作り直す */
function BatchNameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  return (
    <div className="split-settle__field split-settle__field--grow">
      <label className="split-settle__label" htmlFor="settle-batch-name">
        バッチ名
      </label>
      <input
        id="settle-batch-name"
        className="split-settle__control"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim()
          if (next === '') setDraft(name)
          else if (next !== name) onCommit(next)
        }}
      />
    </div>
  )
}
