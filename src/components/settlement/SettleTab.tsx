import { useEffect, useMemo, useRef, useState } from 'react'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import {
  findUnassignedAdvanceEntriesForTarget,
  type UnassignedAdvanceEntryCandidate,
} from '../../domain/settlement/findUnassignedAdvanceEntriesForTarget'
import { buildJournalEntryUpdateWithAssignedSettlementBatch } from '../../domain/settlement/buildJournalEntryUpdateWithAssignedSettlementBatch'
import { resolveSettlementAdjustment } from '../../domain/settlement/resolveSettlementAdjustment'
import { buildSettlementCloseEntries } from '../../domain/settlement-batch/buildSettlementCloseEntries'
import { planSettlementBatchDeletion } from '../../domain/settlement-batch/planSettlementBatchDeletion'
import { resolveSettlementTarget } from '../../domain/settlement-batch/resolveSettlementTarget'
import { isClosedWithBalance, isWaitingToClose, sortClosedWithBalanceFirst } from '../../domain/settlement-batch/settlementBatchStatus'
import type { SettlementBatchSummary, SettlementDirection } from '../../domain/settlement-batch/summarizeSettlementBatch'
import { summarizeSettlementBatches } from '../../domain/settlement-batch/summarizeSettlementBatches'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { JournalFilterPopup } from '../common/journal-filter/JournalFilterPopup'
import { countActiveConditions } from '../common/journal-filter/journalFilterModel'
import { useEscapeToClear } from '../common/range-selection/useEscapeToClear'
import { createRangeSelection, useRangeAnchor } from '../common/range-selection/useRangeSelection'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { SplitSettleData, SplitSettleDerived, SplitSettleRepositories } from './splitSettleData'
import { EntryDetailDialog } from './EntryDetailDialog'
import { findAccountBySystemRole } from '../../domain/account/findAccountBySystemRole'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import { runInHistoryGroup } from '../../infrastructure/history/historyGroupRunner'
import { closeSettlementBatch, reopenSettlementBatch } from './closeSettlementBatch'
import { createSettlementEntry, tagCandidatesToBatch } from './submitSettlement'
import { StickyHeaderTable } from '../common/sticky/StickyHeaderTable'
import './SplitSettleScreen.css'


/** 状態の絞り込み。精算済みはクローズ済みのこと(利用者が決める。残高が0かどうかでは決めない、計画Issue #249) */
type StatusFilter = 'open' | 'settled'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'open', label: '未精算' },
  { key: 'settled', label: '精算済み' },
]

const DIRECTIONS: { key: SettlementDirection; label: string; sub: string }[] = [
  { key: 'advance', label: '未収金を減らす', sub: '相手から受け取る' },
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
  key === 'settled' ? !summary.batch.isActive : summary.batch.isActive

/** 一覧に出す順。精算済みでは、クローズ後に残高が動いたバッチを先頭に出して気づけるようにする */
const listFor = (summaries: readonly SettlementBatchSummary[], key: StatusFilter) => {
  const matched = summaries.filter((s) => matchesStatus(s, key))
  return key === 'settled' ? sortClosedWithBalanceFirst(matched) : matched
}

const signed = (amount: number) => (amount > 0 ? `+${formatCurrency(amount, 'JPY')}` : formatCurrency(amount, 'JPY'))

/**
 * 精算タブ(計画Issue #153、承認済みモックアップ)。精算バッチを先に選び、一覧に立替金と未払金の
 * 残高を別々に出す(合算も相殺もしない)。「未精算」「精算済み」で切り替える。精算済みはクローズ済みのバッチで、
 * 利用者がクローズして決める(計画Issue #249。残高が0になったら「クローズしますか?」と促し、残高があるままでも
 * 残りを雑損失・雑収入へ振り替える仕訳を自動で作ってクローズできる。再オープンでその仕訳を削除する)。選んだバッチの
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
  const [confirmingClose, setConfirmingClose] = useState(false)
  /** 「クローズしますか?」のダイアログを出しているバッチ(残高が0になったとき) */
  const [closeDialogId, setCloseDialogId] = useState<number | null>(null)
  const [confirmingUnlinkLineId, setConfirmingUnlinkLineId] = useState<number | null>(null)
  // 候補のチェックの範囲選択の基点。選択対象(候補)は、下の早期 return のあとで決まるため、基点だけをここで持つ(計画Issue #235 D)
  const rangeAnchor = useRangeAnchor<number>()
  // Esc で候補のチェックをすべて外す
  useEscapeToClear(
    checkedLineIds.size > 0
      ? () => {
          setCheckedLineIds(new Set())
          setFlash('')
        }
      : null,
  )

  const allLines = useMemo(() => data.entries.flatMap((e) => e.lines), [data.entries])
  const summaries = useMemo(
    () => summarizeSettlementBatches(data.batches, allLines, data.accounts),
    [data.batches, allLines, data.accounts],
  )
  const listed = listFor(summaries, statusFilter)
  const summary = summaries.find((s) => s.batch.id === selectedId) ?? listed[0] ?? summaries[0] ?? null

  // 精算して残高が0になったバッチは、未精算のまま「クローズしますか?」と促す(精算済みへ移すのは利用者のクローズ)
  const effectiveId = summary?.batch.id ?? null
  const wasSettled = useRef<{ id: number; settled: boolean } | null>(null)
  useEffect(() => {
    if (summary === null) return
    if (selectedId === null) setSelectedId(summary.batch.id)
    const before = wasSettled.current
    if (before !== null && before.id === summary.batch.id && !before.settled && isWaitingToClose(summary)) {
      setCloseDialogId(summary.batch.id)
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
    setConfirmingClose(false)
    setConfirmingUnlinkLineId(null)
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
  // 残高が負(相手へ返す向きの割勘、計画Issue #271)のときは、精算の向きも逆になる。立替金は借方・未払金は貸方の行で精算し、
  // 残高との比較・差額は絶対値で行う。一時勘定は反対の区分の科目と同じ向きで扱う
  const reversed = resolved.balance < 0
  const baseSide = direction === 'advance' ? 'credit' : 'debit'
  const side = reversed ? (baseSide === 'credit' ? 'debit' : 'credit') : baseSide
  const baseCategory = direction === 'advance' ? 'asset' : 'liability'
  const category = reversed ? (baseCategory === 'asset' ? 'liability' : 'asset') : baseCategory
  const balanceToSettle = Math.abs(resolved.balance)

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
  // 候補のチェックの Shift+クリック(範囲選択)・Ctrl/Cmd+クリック(トグル)・Shift+↑↓、Ctrl/Cmd+行のどこかを押す操作(計画Issue #235 D)
  const rangeSelection = createRangeSelection(rangeAnchor, {
    order: candidates.map((c) => c.lineId),
    selected: [...checkedLineIds],
    onChange: (next) => {
      setCheckedLineIds(new Set(next))
      setFlash('')
    },
  })
  const chosen = candidates.filter((c) => checkedLineIds.has(c.lineId))
  const total = chosen.reduce((sum, c) => sum + c.amount, 0)
  const diff = total - balanceToSettle
  const matched = total > 0 && diff === 0
  const mismatched = total > 0 && diff !== 0

  // 差額の計上先は名前ではなく役割で引く(計画Issue #223)。改名されていても見つかり、表示も今の名前になる
  const gainAccount = findAccountBySystemRole(data.accounts, 'settlement_gain')
  const lossAccount = findAccountBySystemRole(data.accounts, 'settlement_loss')
  const gainId = gainAccount?.id ?? null
  const lossId = lossAccount?.id ?? null
  const adjustAccountName = mismatched
    ? resolveSettlementAdjustment(diff, category).isGain
      ? (gainAccount?.name ?? '雑収入')
      : (lossAccount?.name ?? '雑損失')
    : ''

  const taggedEntries = data.entries.filter((e) => e.lines.some((l) => l.settlementBatchId === batch.id))
  const detailEntry = data.entries.find((e) => e.id === detailEntryId)
  const closeDialogSummary = summaries.find((s) => s.batch.id === closeDialogId && isWaitingToClose(s))
  const taggedEntryIds = taggedEntries.map((e) => e.id)
  const entryHouseholdMemberId = resolved.target?.householdMemberId ?? data.members[0]?.id ?? null

  const run = async (action: () => Promise<void>, done: string, failed = '精算を記録できませんでした') => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await action()
      resetWorking()
      await onChanged()
      setFlash(done)
    } catch {
      setError(failed)
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
        runInHistoryGroup(repositories.history, 'settlement.tagCandidates', () =>
          tagCandidatesToBatch({
            batchId: batch.id,
            taggedEntryIds,
            direction,
            accountId: directionSummary.accountId,
            target: resolved.target!,
            entryHouseholdMemberId,
            resolveLineHouseholdMemberId: createLineHouseholdMemberResolver(data.accounts, entryHouseholdMemberId),
            repositories,
            reversed,
            candidates: chosen,
            diff,
            createAdjustment,
            adjustmentAccountIds: { gain: gainId ?? 0, loss: lossId ?? 0 },
            today,
          }),
        ),
      createAdjustment && mismatched
        ? `差額を${adjustAccountName}に計上して精算しました`
        : createAdjustment || matched
          ? '精算が完了しました'
          : '選択した仕訳をバッチに割り当てました',
    )
  }

  const closeEntryIds = data.closeEntries.find((c) => c.batchId === batch.id)?.entryIds ?? []
  const accountName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? ''
  // 残高があるままクローズするときに自動で作る振替仕訳(確認に内容を見せる)
  const closePreview =
    batch.isActive && !summary.isSettled
      ? buildSettlementCloseEntries({
          summary,
          accounts: data.accounts,
          gainAccountId: gainId ?? 0,
          lossAccountId: lossId ?? 0,
          entryDate: today,
          memo: null,
        })
      : []

  // クローズする。残高があれば、残りを雑損失・雑収入へ振り替える仕訳を自動で作る(確認のあとだけ)。終わったら精算済みへ移して選んだままにする
  const closeBatch = (target: SettlementBatchSummary) => {
    if (!isWaitingToClose(target) && (gainId === null || lossId === null)) {
      setError('差額を計上する科目(雑収入・雑損失)が見つかりません')
      return
    }
    const taggedIds = data.entries.filter((e) => e.lines.some((l) => l.settlementBatchId === target.batch.id)).map((e) => e.id)
    void run(
      async () => {
        await runInHistoryGroup(repositories.history, 'settlement.close', () =>
          closeSettlementBatch({
            summary: target,
            accounts: data.accounts,
            taggedEntryIds: taggedIds,
            gainAccountId: gainId ?? 0,
            lossAccountId: lossId ?? 0,
            entryDate: today,
            repositories,
          }),
        )
        setCloseDialogId(null)
        setStatusFilter('settled')
        setSelectedId(target.batch.id)
      },
      target.isSettled ? 'クローズしました。精算済みに移りました' : 'クローズしました。残高を振り替える仕訳を作成しました',
      'クローズできませんでした',
    )
  }

  const reopenBatch = () =>
    void run(
      async () => {
        await runInHistoryGroup(repositories.history, 'settlement.reopen', () =>
          reopenSettlementBatch({ batchId: batch.id, repositories }),
        )
        setStatusFilter('open')
        setSelectedId(batch.id)
      },
      closeEntryIds.length > 0
        ? `再オープンしました。自動仕訳${closeEntryIds.length}件を削除し、残高を元に戻しました`
        : '再オープンしました。未精算に戻りました',
      '再オープンできませんでした',
    )

  const deletion = planSettlementBatchDeletion(batch.id, data.entries)

  // 割勘仕訳を消してから、最後にバッチを消す(紐づく明細があるバッチはDBが削除を拒否するため)
  const deleteBatch = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await runInHistoryGroup(repositories.history, 'settlement.deleteBatch', async () => {
        for (const id of deletion.splitEntryIds) await repositories.journalEntryRepository.delete(id)
        await repositories.settlementBatchRepository.delete(batch.id)
      })
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

  // 精算タブが紐づけるのは、残高を減らす側の行(立替金の貸方・未払金の借方)だけ。債権債務を生む側の行は
  // 割勘や仕訳画面で付けたものなので、ここでは解除できない
  const isSettlingLine = (l: { accountId: number; side: 'debit' | 'credit' }) =>
    (l.accountId === summary.advance?.accountId && l.side === (reversed ? 'debit' : 'credit')) ||
    (l.accountId === summary.payable?.accountId && l.side === (reversed ? 'credit' : 'debit'))

  // 精算で紐づけた行のタグだけを外して、未割当(候補)に戻す。仕訳は削除しない
  const unlinkLine = (entryId: number, lineId: number) => {
    const target = data.entries.find((e) => e.id === entryId)
    if (target === undefined) return
    void run(async () => {
      await repositories.journalEntryRepository.update(
        entryId,
        buildJournalEntryUpdateWithAssignedSettlementBatch(target, lineId, null),
      )
    }, '紐づけを解除しました')
  }

  const createDraft = () => {
    const amount = Number(draftAmount)
    if (!(amount > 0) || draftAccount === '') {
      setError('相手科目と金額を入力してください')
      return
    }
    if (resolved.target === null || directionSummary === null || entryHouseholdMemberId === null) return
    void run(
      () =>
        runInHistoryGroup(repositories.history, 'settlement.createEntry', async () => {
          await createSettlementEntry({
            batchId: batch.id,
            taggedEntryIds,
            direction,
            accountId: directionSummary.accountId,
            target: resolved.target!,
            entryHouseholdMemberId,
            resolveLineHouseholdMemberId: createLineHouseholdMemberResolver(data.accounts, entryHouseholdMemberId),
            repositories,
            reversed,
            counterAccountId: Number(draftAccount),
            amount,
            entryDate: draftDate,
            memo: `${batch.name} 精算`,
          })
        }),
      '仕訳を起票してバッチに紐付けました',
    )
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
                const first = listFor(summaries, item.key)[0]
                if (first !== undefined) setSelectedId(first.batch.id)
                resetWorking()
              }}
            >
              {item.label} {listFor(summaries, item.key).length}
            </button>
          ))}
        </div>
        <StickyHeaderTable
          frameClassName="split-settle__scroll"
          tableClassName="split-settle__table"
          floatingClassName="floating-table-header--bare"
          head={
            <thead>
              <tr>
                <th>バッチ名</th>
                <th className="split-settle__num">未収金</th>
                <th className="split-settle__num">未払金</th>
              </tr>
            </thead>
          }
        >
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
                  {isWaitingToClose(s) && <span className="split-settle__badge split-settle__badge--warn">残高0 · クローズ待ち</span>}
                  {isClosedWithBalance(s) && <span className="split-settle__badge split-settle__badge--warn">残高あり</span>}
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
        </StickyHeaderTable>
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
              favoriteKind="counterparty"
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
        {!batch.isActive && summary.isSettled && (
          <p className="split-settle__settled">
            精算済みです(クローズ済み)。選択欄の候補には出ません。
            {closeEntryIds.length > 0 && (
              <>
                <br />
                <span className="split-settle__settled-sub">
                  クローズ時に残りの残高を、自動仕訳で振り替えました(下の「このバッチの仕訳」)。
                </span>
              </>
            )}
          </p>
        )}
        {isClosedWithBalance(summary) && (
          <p className="split-settle__closed-warn" role="alert">
            <strong>精算済みですが、残高が残っています。</strong>
            <span>クローズ後に仕訳が編集された可能性があります。再オープンして精算し直してください。</span>
          </p>
        )}
        {isWaitingToClose(summary) && (
          <div className="split-settle__suggest">
            <span className="split-settle__suggest-text">
              <strong>残高が0になりました。クローズしますか?</strong>
              <span className="split-settle__note">
                クローズすると精算済みに移り、選択欄の候補に出なくなります(あとで再オープンできます)。
              </span>
            </span>
            <button
              type="button"
              className="split-settle__btn split-settle__btn--small split-settle__btn--primary"
              disabled={submitting}
              onClick={() => closeBatch(summary)}
            >
              クローズする
            </button>
          </div>
        )}

        {batch.isActive && !summary.isSettled && (
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
                        <tr key={c.lineId} {...rangeSelection.selectingRowProps(c.lineId)}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${memo}を選択`}
                              checked={checkedLineIds.has(c.lineId)}
                              {...rangeSelection.checkboxProps(c.lineId)}
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
            {reversed && (
              <p className="split-settle__note">
                {`残高がマイナス(${formatCurrency(resolved.balance, 'JPY')})です。相手へ返す側の精算なので、${
                  direction === 'advance' ? '立替金を借方に持つ' : '未払金を貸方に持つ'
                }仕訳を選んでください。`}
              </p>
            )}
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
                if (!draftOpen && draftAmount === '') setDraftAmount(String(balanceToSettle))
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
                    favoriteKind="account"
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

        <div className="split-settle__section">
          <h3 className="split-settle__h3">このバッチの仕訳</h3>
          {taggedEntries.flatMap((entry) =>
            entry.lines
              .filter((l) => l.settlementBatchId === batch.id)
              .map((l) => (
                <div key={l.id}>
                  <div className="split-settle__tagged">
                    <button
                      type="button"
                      className="split-settle__link split-settle__link--grow"
                      onClick={() => setDetailEntryId(entry.id)}
                    >
                      {entry.entryDate} {entry.memo ?? ''}
                    </button>
                    {closeEntryIds.includes(entry.id) && <span className="split-settle__badge">自動仕訳</span>}
                    <span className="split-settle__note split-settle__tagged-account">
                      {l.side === 'debit' ? '借方' : '貸方'} {data.accounts.find((a) => a.id === l.accountId)?.name ?? ''}
                    </span>
                    <span className="split-settle__num split-settle__tagged-amount">{formatCurrency(l.amount, 'JPY')}</span>
                    {/* 解除ボタンの有無で金額の位置がずれないよう、ボタンの欄は常に同じ幅を確保する */}
                    <span className="split-settle__tagged-action">
                      {isSettlingLine(l) && (
                        <button
                          type="button"
                          className="split-settle__btn split-settle__btn--small"
                          aria-label={`${entry.memo ?? ''}の紐づけを解除`}
                          onClick={() => setConfirmingUnlinkLineId(l.id)}
                        >
                          紐づけを解除
                        </button>
                      )}
                    </span>
                  </div>
                  {confirmingUnlinkLineId === l.id && (
                    <div className="split-settle__unlink-confirm">
                      <p className="split-settle__note">
                        この行のバッチへの紐づけを外します。仕訳は削除せず、行は候補に戻り、バッチの残高が増えます。
                        精算の仕訳を間違えて作った場合は、仕訳画面で削除してください。
                      </p>
                      <span className="split-settle__confirm">
                        <button
                          type="button"
                          className="split-settle__btn split-settle__btn--small"
                          onClick={() => setConfirmingUnlinkLineId(null)}
                        >
                          やめる
                        </button>
                        <button
                          type="button"
                          className="split-settle__btn split-settle__btn--small split-settle__btn--danger"
                          disabled={submitting}
                          onClick={() => unlinkLine(entry.id, l.id)}
                        >
                          本当に解除する
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )),
          )}
        </div>

        <div className="split-settle__section">
          <h3 className="split-settle__h3">バッチのクローズ</h3>
          {!batch.isActive ? (
            <>
              <p className="split-settle__note">
                {closeEntryIds.length > 0
                  ? `再オープンすると、クローズ時の自動仕訳(${closeEntryIds.length}件)を削除し、バッチの残高を元に戻して、未精算に戻します。`
                  : '再オープンすると未精算に戻り、また選択欄で選べるようになります。'}
              </p>
              <div>
                <button type="button" className="split-settle__btn split-settle__btn--small" disabled={submitting} onClick={reopenBatch}>
                  {closeEntryIds.length > 0 ? '再オープンして自動仕訳を削除' : '再オープンする'}
                </button>
              </div>
            </>
          ) : confirmingClose && closePreview.length > 0 ? (
            <div className="split-settle__close-confirm">
              <p className="split-settle__note split-settle__note--warn-text">
                <strong>残高があります。</strong>
                クローズすると、残りの残高を雑損失・雑収入へ振り替える仕訳を自動で作り、残高を0にして精算済みに移します。
              </p>
              <div className="split-settle__close-preview">
                <span className="split-settle__label">作成される仕訳(取引日 {today})</span>
                {closePreview.map((e, i) => {
                  const debit = e.lines.find((l) => l.side === 'debit')
                  const credit = e.lines.find((l) => l.side === 'credit')
                  return (
                    <div key={i} className="split-settle__close-preview-row">
                      <span>{`借方 ${accountName(debit?.accountId ?? 0)} / 貸方 ${accountName(credit?.accountId ?? 0)}`}</span>
                      <span className="split-settle__num">{formatCurrency(debit?.amount ?? 0, 'JPY')}</span>
                    </div>
                  )
                })}
              </div>
              <p className="split-settle__note">再オープンすると、この仕訳は削除されます。</p>
              <span className="split-settle__confirm">
                <button type="button" className="split-settle__btn split-settle__btn--small" onClick={() => setConfirmingClose(false)}>
                  やめる
                </button>
                <button
                  type="button"
                  className="split-settle__btn split-settle__btn--small split-settle__btn--primary"
                  disabled={submitting}
                  onClick={() => closeBatch(summary)}
                >
                  仕訳を作ってクローズする
                </button>
              </span>
            </div>
          ) : (
            <>
              <p className="split-settle__note">
                クローズすると精算済みに移ります。
                {summary.isSettled ? '' : '残高があるときは、残りを雑損失・雑収入に振り替える仕訳を自動で作ります(確認が出ます)。'}
              </p>
              <div>
                <button
                  type="button"
                  className="split-settle__btn split-settle__btn--small"
                  disabled={submitting}
                  onClick={() => (summary.isSettled || closePreview.length === 0 ? closeBatch(summary) : setConfirmingClose(true))}
                >
                  このバッチをクローズ
                </button>
              </div>
            </>
          )}
        </div>

        {batch.isActive && !summary.isSettled && (
          <div className="split-settle__section">
            <h3 className="split-settle__h3">バッチの削除</h3>
            {!deletion.deletable ? (
              <>
                <p className="split-settle__note">
                  割勘仕訳以外の仕訳(精算で紐づけた仕訳や、手入力の仕訳)が紐づいているため、削除できません。精算で紐づけた行は「紐づけを解除」で外せます。
                </p>
                <button type="button" className="split-settle__btn split-settle__btn--small split-settle__btn--danger" disabled>
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
                    className="split-settle__btn split-settle__btn--small split-settle__btn--danger-solid"
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
                className="split-settle__btn split-settle__btn--small split-settle__btn--danger-solid"
                onClick={() => setConfirmingDelete(true)}
              >
                このバッチを削除
              </button>
            )}
          </div>
        )}
      </section>

      {closeDialogSummary !== undefined && (
        <div className="split-settle__backdrop">
          <div role="dialog" aria-label="クローズの確認" className="split-settle__dialog split-settle__dialog--small">
            <h3 className="split-settle__dialog-title">クローズしますか?</h3>
            <p className="split-settle__dialog-body">
              「{closeDialogSummary.batch.name}」の残高が0になりました。
              <br />
              <span className="split-settle__nowrap-phrase">クローズすると精算済みになり、</span>
              <span className="split-settle__nowrap-phrase">選択欄の候補に出なくなります。</span>
              <br />
              あとで再オープンもできます。
            </p>
            <div className="split-settle__dialog-actions">
              <button type="button" className="split-settle__btn split-settle__btn--small" onClick={() => setCloseDialogId(null)}>
                あとで
              </button>
              <button
                type="button"
                className="split-settle__btn split-settle__btn--small split-settle__btn--primary"
                disabled={submitting}
                onClick={() => closeBatch(closeDialogSummary)}
              >
                クローズする
              </button>
            </div>
          </div>
        </div>
      )}

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
