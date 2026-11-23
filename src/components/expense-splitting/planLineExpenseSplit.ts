import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { allocateSignedAcrossLines } from '../../domain/expense-splitting/allocateSignedAcrossLines'
import { signedLineAmount } from '../../domain/expense-splitting/listSplittableLineEntries'
import type { ExpenseSplittingAllocationMode, ExpenseSplittingParticipantRow } from './expenseSplittingFormParticipant'

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
  /** 割合の合計が100%でない(立て替えた本人も、負担する人として入れる) */
  | 'ratioTotalMismatch'
  /** 金額の合計が、選んだ行の純額と合わない */
  | 'amountTotalMismatch'

export interface PlannedRecipient {
  row: ExpenseSplittingParticipantRow
  /** 選んだ行ごとの、仕訳にする相手の負担額。selectedLinesと同じ並びで、借方の行は正・貸方の行は負。自分が立て替えた行は0 */
  signedShares: number[]
}

export type PlanLineExpenseSplitResult =
  | {
      ok: true
      /** 仕訳にする相手(立て替えた本人だけの行・負担が0の行は含まない) */
      recipients: PlannedRecipient[]
      /** 人ごとの負担額の合計(符号付き。自分が立て替えた行の分も含む。キーは行のkey)。画面の表示用 */
      burdens: Map<number, number>
    }
  | { ok: false; error: PlanLineExpenseSplitError }

/**
 * 選んだ明細行と、負担する人ごとの入力から、人ごとの行ごとの負担額(符号付き)を決める(計画Issue #271)。
 * submitExpenseSplit(書き込み)と割勘仕訳のプレビューが同じ計算を使う。DBアクセスなしの純粋関数。
 *
 * 負担する人には、立て替えた本人も入れる(誰がどのくらい負担するかを、全員分そろえて入力する)。割合は合計100%、金額は
 * 合計が選んだ行の純額に合わないと、ratioTotalMismatch・amountTotalMismatchを返す(均等は入力した人だけで等分する)。
 * 均等・割合は行ごとに行の金額を人数・割合で按分する(端数は最大剰余法で、合計は行の金額と一致する)。借方の行は正、
 * 貸方の行は負の負担額になる。金額指定は、選んだ行の借方を正・貸方を負とした純額に対して、人ごとの金額を行へ純額に
 * 対する割合で配分する(allocateSignedAcrossLines)。純額が0なら基準がなく、amountNetZeroを返す。
 * 世帯メンバーの人が自分で立て替えた行(元の仕訳の起票者が本人)の分は、自分との割勘になって意味がないので仕訳にしない
 * (その分は元のまま自分の負担として残る)。世帯外の相手(取引先)は、すべての行が対象。
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
  const net = signedAmounts.reduce((sum, n) => sum + n, 0)
  const rows = participants.filter((row) => row.targetId !== null)

  /** 行ごと・人ごとの、自分が立て替えた分を含む負担額(符号付き) */
  const burdenSharesByRow = new Map<number, number[]>()
  const burdens = new Map<number, number>()
  if (allocationMode === 'amount') {
    if (net === 0) return { ok: false, error: 'amountNetZero' }
    const entered = rows.map((row) => ({ row, amount: Number(row.amountInput) }))
    const total = entered.reduce((sum, { amount }) => sum + (Number.isFinite(amount) && amount > 0 ? amount : 0), 0)
    if (total !== Math.abs(net)) return { ok: false, error: 'amountTotalMismatch' }
    for (const { row, amount } of entered) {
      const valid = Number.isFinite(amount) && amount > 0
      burdenSharesByRow.set(row.key, valid ? allocateSignedAcrossLines(Math.sign(net) * amount, signedAmounts) : signedAmounts.map(() => 0))
      burdens.set(row.key, valid ? Math.sign(net) * amount : 0)
    }
  } else {
    const weights = rows.map((row) => (allocationMode === 'ratio' ? Math.max(0, Number(row.ratioInput) || 0) : 1))
    if (allocationMode === 'ratio' && Math.abs(weights.reduce((sum, w) => sum + w, 0) - 100) > 1e-9) {
      return { ok: false, error: 'ratioTotalMismatch' }
    }
    // 行ごとに、行の金額を重みで按分する(端数は最大剰余法)。借方の行は正、貸方の行は負にする
    const perLine = selectedLines.map(({ line }) => allocateSignedAcrossLines(line.amount, weights))
    rows.forEach((row, rowIndex) => {
      const shares = perLine.map((allocated, i) => Math.sign(signedAmounts[i]) * (allocated[rowIndex] ?? 0))
      burdenSharesByRow.set(row.key, shares)
      burdens.set(row.key, shares.reduce((sum, n) => sum + n, 0))
    })
  }

  const recipients: PlannedRecipient[] = []
  for (const row of rows) {
    const burdenShares = burdenSharesByRow.get(row.key) ?? []
    const signedShares = burdenShares.map((share, i) =>
      row.kind === 'householdMember' && selectedLines[i].entry.householdMemberId === row.targetId ? 0 : share,
    )
    if (signedShares.some((n) => n !== 0)) recipients.push({ row, signedShares })
  }
  if (recipients.length === 0) return { ok: false, error: 'noRecipient' }
  return { ok: true, recipients, burdens }
}
