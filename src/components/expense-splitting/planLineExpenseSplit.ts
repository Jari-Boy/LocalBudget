import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { allocateSignedAcrossLines } from '../../domain/expense-splitting/allocateSignedAcrossLines'
import { signedLineAmount } from '../../domain/expense-splitting/listSplittableLineEntries'
import {
  calculateParticipantAmounts,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'

/** 割勘する行1つ。entryは行を持つ元の仕訳(立替者・関連仕訳グループの特定に使う) */
export interface SelectedSplitLine {
  entry: JournalEntry
  line: JournalLine
}

export type PlanLineExpenseSplitError =
  | 'expenseAccountNotFound'
  | 'noRecipient'
  /** 金額指定で、選んだ行の借方・貸方を差し引いた純額が0円(配分の基準がない) */
  | 'amountNetZero'
  /** 金額指定の合計が、選んだ行の純額を超える */
  | 'amountExceedsTotal'

export interface PlannedRecipient {
  row: ExpenseSplittingParticipantRow
  /** 選んだ行ごとの相手の負担額。selectedLinesと同じ並びで、借方の行は正・貸方の行は負 */
  signedShares: number[]
}

export type PlanLineExpenseSplitResult =
  | { ok: true; recipients: PlannedRecipient[] }
  | { ok: false; error: PlanLineExpenseSplitError }

/**
 * 選んだ明細行と分担相手から、相手ごとの行ごとの負担額(符号付き)を決める(計画Issue #271)。submitExpenseSplit(書き込み)と
 * 割勘仕訳のプレビューが同じ計算を使う。DBアクセスなしの純粋関数。
 *
 * 均等・割合は、行ごとに行の金額を按分する(借方の行は正、貸方の行は負の負担額になる)。金額指定は、選んだ行の借方を正・
 * 貸方を負とした純額に対して、人ごとに入力した金額を行へ純額に対する割合で配分する(allocateSignedAcrossLines)。
 * 世帯メンバーの相手が自分で立て替えた行は、その相手の割当から除く(自分との割勘にしない)。金額指定の純額は、その行を除いて数える。
 * 純額が0なら基準がなく、人ごとの合計が純額を超えるときも、エラーを返す。分担相手が未選択の行(targetIdがnull)は
 * 計算に含めない。負担額がすべて0の相手は結果に含めない。
 */
export function planLineExpenseSplit(params: {
  selectedLines: readonly SelectedSplitLine[]
  accounts: readonly Account[]
  participants: readonly ExpenseSplittingParticipantRow[]
  allocationMode: ExpenseSplittingAllocationMode
}): PlanLineExpenseSplitResult {
  const { selectedLines, accounts, participants, allocationMode } = params

  const profitLossAccountIds = new Set(
    accounts.filter((a) => a.category === 'expense' || a.category === 'revenue').map((a) => a.id),
  )
  if (selectedLines.length === 0 || selectedLines.some(({ line }) => !profitLossAccountIds.has(line.accountId))) {
    return { ok: false, error: 'expenseAccountNotFound' }
  }

  const signedAmounts = selectedLines.map(({ line }) => signedLineAmount(line))
  const selectedRows = participants.filter((row) => row.targetId !== null)

  /**
   * この相手に割り当てる行。世帯メンバーの相手が自分で立て替えた行(元の仕訳の起票者が相手本人)は、自分との割勘になって
   * 意味がないので除く。世帯外の相手(取引先)は、すべての行が対象
   */
  const eligibleFor = (row: ExpenseSplittingParticipantRow) =>
    selectedLines.map(({ entry }) => !(row.kind === 'householdMember' && entry.householdMemberId === row.targetId))

  const signedSharesByRow = new Map<number, number[]>()
  if (allocationMode === 'amount') {
    const entered = selectedRows
      .map((row) => ({ row, amount: Number(row.amountInput), eligible: eligibleFor(row) }))
      .filter(({ amount }) => Number.isFinite(amount) && amount > 0)
    for (const { row, amount, eligible } of entered) {
      const eligibleAmounts = signedAmounts.filter((_, i) => eligible[i])
      const eligibleNet = eligibleAmounts.reduce((sum, n) => sum + n, 0)
      if (eligibleAmounts.length === 0) continue
      if (eligibleNet === 0) return { ok: false, error: 'amountNetZero' }
      if (amount > Math.abs(eligibleNet)) return { ok: false, error: 'amountExceedsTotal' }
      const allocated = allocateSignedAcrossLines(Math.sign(eligibleNet) * amount, eligibleAmounts)
      let next = 0
      signedSharesByRow.set(row.key, eligible.map((isEligible) => (isEligible ? allocated[next++] : 0)))
    }
    // 人ごとの金額の合計が、全体の純額を超えるときもエラー(立替者の取り分が負になるため)
    const net = signedAmounts.reduce((sum, n) => sum + n, 0)
    if (net !== 0 && entered.reduce((sum, { amount }) => sum + amount, 0) > Math.abs(net)) {
      return { ok: false, error: 'amountExceedsTotal' }
    }
  } else {
    const perLine = selectedLines.map(({ line }) => calculateParticipantAmounts(line.amount, participants, allocationMode))
    for (const row of selectedRows) {
      const eligible = eligibleFor(row)
      signedSharesByRow.set(
        row.key,
        perLine.map((amounts, i) => (eligible[i] ? Math.sign(signedAmounts[i]) * (amounts.get(String(row.key)) ?? 0) : 0)),
      )
    }
  }

  const recipients = selectedRows
    .filter((row) => (signedSharesByRow.get(row.key) ?? []).some((n) => n !== 0))
    .map((row) => ({ row, signedShares: signedSharesByRow.get(row.key) as number[] }))
  if (recipients.length === 0) return { ok: false, error: 'noRecipient' }
  return { ok: true, recipients }
}
