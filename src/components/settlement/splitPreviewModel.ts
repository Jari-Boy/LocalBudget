import type { Account } from '../../domain/account/Account'
import type { JournalLineInput } from '../../domain/journal/JournalEntry'
import { buildLineExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildLineExpenseSplittingJournalEntryInput'
import { pairLinesBySide } from '../journal-entry/journalLineTableModel'
import type { ExpenseSplittingAllocationMode, ExpenseSplittingParticipantRow } from '../expense-splitting/expenseSplittingFormParticipant'
import { planLineExpenseSplit, type SelectedSplitLine } from '../expense-splitting/planLineExpenseSplit'

/**
 * 割勘仕訳のプレビュー(計画Issue #271)の組み立て。割勘タブで、いま選んでいる行と分担から作られる仕訳を、
 * 記録する前に確認できるようにする。仕訳の組み立ては記録のときと同じ(planLineExpenseSplit・
 * buildLineExpenseSplittingJournalEntryInput)。読み取り専用で、金額は直接編集できない。DB・DOM非依存。
 */

export interface SplitPreviewLine {
  accountName: string
  memberName: string
  /** 取引先(世帯外の相手)または精算バッチの名前。無ければ空文字 */
  partner: string
  amount: number
}

export interface SplitPreviewRow {
  debit: SplitPreviewLine | null
  credit: SplitPreviewLine | null
  /** 「元の行」の列の説明 */
  source: string
}

export interface SplitPreview {
  /** 分担相手の行のkey */
  rowKey: number
  partnerName: string
  rows: SplitPreviewRow[]
  debitTotal: number
  creditTotal: number
}

export function buildSplitPreviews(params: {
  selectedLines: readonly SelectedSplitLine[]
  accounts: readonly Account[]
  participants: readonly ExpenseSplittingParticipantRow[]
  allocationMode: ExpenseSplittingAllocationMode
  today: string
  /** 精算バッチの名前(新しく作るときは摘要、既存なら既存の名前) */
  batchLabel: string
  accountName: (accountId: number) => string
  memberName: (memberId: number) => string
  counterpartyName: (counterpartyId: number) => string
}): SplitPreview[] {
  const { selectedLines, accounts } = params
  const plan = planLineExpenseSplit({
    selectedLines,
    accounts,
    participants: params.participants,
    allocationMode: params.allocationMode,
  })
  if (!plan.ok) return []

  const advanceAssetAccountId = accounts.find((a) => a.category === 'asset' && a.isSystemManaged)?.id
  const advanceLiabilityAccountId = accounts.find((a) => a.category === 'liability' && a.isSystemManaged)?.id ?? null
  if (advanceAssetAccountId === undefined) return []

  const view = (l: JournalLineInput): SplitPreviewLine => ({
    accountName: params.accountName(l.accountId),
    memberName: params.memberName(l.householdMemberId),
    partner:
      l.counterpartyId != null
        ? params.counterpartyName(l.counterpartyId)
        : l.settlementBatchId != null
          ? params.batchLabel
          : '',
    amount: l.amount,
  })

  return plan.recipients.flatMap(({ row, signedShares }) => {
    if (row.targetId === null) return []
    const nonZero = selectedLines.filter((_, i) => signedShares[i] !== 0)
    const input = buildLineExpenseSplittingJournalEntryInput({
      advanceAssetAccountId,
      advanceLiabilityAccountId,
      settlementBatchId: 0,
      entryDate: params.today,
      memo: null,
      recipient:
        row.kind === 'householdMember'
          ? { kind: 'householdMember', toMemberId: row.targetId }
          : { kind: 'counterparty', counterpartyId: row.targetId },
      shares: selectedLines.map(({ entry, line }, i) => ({
        sourceLineId: line.id,
        accountId: line.accountId,
        projectId: line.projectId,
        signedAmount: signedShares[i],
        payerMemberId: entry.householdMemberId,
      })),
    })

    const profitLoss = input.lines.filter((l) => l.settlementBatchId == null)
    const advance = input.lines.filter((l) => l.settlementBatchId != null)
    const rows: SplitPreviewRow[] = []

    // 付け替えの行。世帯メンバーへは借方・貸方の2行1組、世帯外の相手へは1行ずつ。組ごとに、元の行の説明を添える
    const sourceOf = (index: number): string => {
      const { entry, line } = nonZero[index]
      const memo = entry.memo === null || entry.memo === '' ? '(摘要なし)' : entry.memo
      return `${memo} ${params.accountName(line.accountId)}(${line.side === 'debit' ? '借方' : '貸方'})`
    }
    if (row.kind === 'householdMember') {
      for (let i = 0; i < nonZero.length; i++) {
        const pair = pairLinesBySide(profitLoss.slice(i * 2, i * 2 + 2))[0]
        rows.push({ debit: pair.debit && view(pair.debit), credit: pair.credit && view(pair.credit), source: sourceOf(i) })
      }
    } else {
      profitLoss.forEach((l, i) => {
        rows.push({
          debit: l.side === 'debit' ? view(l) : null,
          credit: l.side === 'credit' ? view(l) : null,
          source: sourceOf(i),
        })
      })
    }
    // 立替金・未払金の行(純額)。借方を左・貸方を右に並べる
    pairLinesBySide(advance).forEach((pair) => {
      rows.push({ debit: pair.debit && view(pair.debit), credit: pair.credit && view(pair.credit), source: '上の差し引き' })
    })

    const total = (side: 'debit' | 'credit') => input.lines.filter((l) => l.side === side).reduce((sum, l) => sum + l.amount, 0)
    return [
      {
        rowKey: row.key,
        partnerName: row.kind === 'householdMember' ? params.memberName(row.targetId) : params.counterpartyName(row.targetId),
        rows,
        debitTotal: total('debit'),
        creditTotal: total('credit'),
      },
    ]
  })
}
