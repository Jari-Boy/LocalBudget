import type { CreateJournalEntryInput, JournalLineInput } from '../journal/JournalEntry'

/** 割る行1つ分の配分。signedAmountは相手の負担額で、元の行が借方なら正・貸方なら負(0は含めない扱い) */
export interface LineExpenseSplitShare {
  /** 元の行のid(割勘対象行の記録に残す) */
  sourceLineId: number
  /** 元の行の科目(費用または収益) */
  accountId: number
  /** 元の行のプロジェクト(イベント)。付け替えの行に引き継ぐ */
  projectId: number | null
  signedAmount: number
}

export type LineExpenseSplitRecipient =
  | { kind: 'householdMember'; toMemberId: number }
  | { kind: 'counterparty'; counterpartyId: number }

export interface BuildLineExpenseSplittingJournalEntryInputParams {
  advanceAssetAccountId: number
  /** 世帯メンバーへの割勘で使う未払金(負債)科目。世帯外の相手では使わない */
  advanceLiabilityAccountId: number | null
  /** 元の支出者(立替者)の世帯メンバー。割勘仕訳の起票者にもなる */
  payerMemberId: number
  settlementBatchId: number
  entryDate: string
  memo: string | null
  recipient: LineExpenseSplitRecipient
  shares: readonly LineExpenseSplitShare[]
}

/**
 * 行単位の割勘(計画Issue #271)で、分担相手1人分の割勘仕訳を組み立てる純粋関数。docs/domain/expense-splitting.md の
 * 1.3・1.4節の仕訳パターンを、行ごとに借方・貸方の向きを選べる形に一般化したもの。
 * - 借方の行(signedAmount > 0): 費用・収益を立替者から相手へ付け替え、相手の負担ぶんだけ立替金(資産)・未払金(負債)を増やす
 * - 貸方の行(signedAmount < 0。返金・値引き・収益): 付け替えも立替金・未払金も逆向きにする
 * 付け替えの行は元の行ごとに残す(元の行との対応を追えるようにするため、合算しない)。立替金・未払金の行は、
 * 借方・貸方の差し引き(純額)で1行ずつにまとめる(純額が0なら作らない)。純額が負なら借方・貸方が逆になる。
 * 配分が0円の行は含めない。元の行のidは expenseSplitSourceLineIds に入れ、割勘対象行の記録として保存させる。
 */
export function buildLineExpenseSplittingJournalEntryInput(
  params: BuildLineExpenseSplittingJournalEntryInputParams,
): CreateJournalEntryInput {
  const { recipient, payerMemberId, settlementBatchId } = params
  const shares = params.shares.filter((s) => s.signedAmount !== 0)

  const lines: JournalLineInput[] = []
  for (const share of shares) {
    const amount = Math.abs(share.signedAmount)
    const forward = share.signedAmount > 0
    if (recipient.kind === 'householdMember') {
      lines.push(
        {
          accountId: share.accountId,
          householdMemberId: forward ? recipient.toMemberId : payerMemberId,
          projectId: share.projectId,
          side: 'debit',
          amount,
        },
        {
          accountId: share.accountId,
          householdMemberId: forward ? payerMemberId : recipient.toMemberId,
          projectId: share.projectId,
          side: 'credit',
          amount,
        },
      )
    } else {
      lines.push({
        accountId: share.accountId,
        householdMemberId: payerMemberId,
        counterpartyId: recipient.counterpartyId,
        projectId: share.projectId,
        side: forward ? 'credit' : 'debit',
        amount,
      })
    }
  }

  const net = shares.reduce((sum, s) => sum + s.signedAmount, 0)
  if (net !== 0) {
    const receivable = net > 0
    lines.push({
      accountId: params.advanceAssetAccountId,
      householdMemberId: payerMemberId,
      settlementBatchId,
      side: receivable ? 'debit' : 'credit',
      amount: Math.abs(net),
    })
    if (recipient.kind === 'householdMember' && params.advanceLiabilityAccountId !== null) {
      lines.push({
        accountId: params.advanceLiabilityAccountId,
        householdMemberId: recipient.toMemberId,
        settlementBatchId,
        side: receivable ? 'credit' : 'debit',
        amount: Math.abs(net),
      })
    }
  }

  return {
    entryDate: params.entryDate,
    memo: params.memo,
    householdMemberId: payerMemberId,
    sourceType: 'expense_splitting',
    lines,
    expenseSplitSourceLineIds: shares.map((s) => s.sourceLineId),
  }
}
