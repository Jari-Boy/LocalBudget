import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import type { AccountCategory } from '../account/Account'

export interface BuildSettlementJournalEntryInputParams {
  /** 消込対象の仕訳(割勘仕訳等)のid。settlesリンクのto_entryとなる */
  targetEntryId: number
  /** 一時勘定(立替金)科目のid */
  settlementAccountId: number
  /** 一時勘定科目の区分。借方/貸方の組み立てを左右する */
  settlementAccountCategory: Extract<AccountCategory, 'asset' | 'liability'>
  /** 実際の入出金が発生した口座科目のid */
  counterAccountId: number
  amount: number
  /** 精算する当人(一時勘定行のhousehold_member_id、精算仕訳の起票者にもなる) */
  householdMemberId: number
  /** 割勘バッチを表すproject_id。世帯外相手の精算等、割勘に紐づかない消込ではnull */
  projectId: number | null
  entryDate: string
  memo?: string | null
}

/**
 * 精算(立替金の消込)仕訳を生成する純粋関数(docs/domain/expense-splitting.md 1.3節の
 * 精算1・精算2、A7消込ロジックの再利用)。一時勘定の区分に応じて借方/貸方を入れ替える。
 * - liability(立替金負債の消込、精算1): 一時勘定を借方(負債の減少)、口座を貸方にする
 * - asset(立替金資産の消込、精算2): 口座を借方、一時勘定を貸方(資産の減少)にする
 * 返り値のlinksに対象仕訳へのsettlesリンクを含め、精算仕訳自体の作成とリンクの作成を
 * 単一のDBトランザクションにする(docs/domain/journal.md 1.8と同じパターン)。
 */
export function buildSettlementJournalEntryInput(
  params: BuildSettlementJournalEntryInputParams,
): CreateJournalEntryInput {
  const settlementLine = {
    accountId: params.settlementAccountId,
    projectId: params.projectId,
    householdMemberId: params.householdMemberId,
    amount: params.amount,
  }
  const counterLine = { accountId: params.counterAccountId, amount: params.amount }

  const lines =
    params.settlementAccountCategory === 'liability'
      ? [
          { ...settlementLine, side: 'debit' as const },
          { ...counterLine, side: 'credit' as const },
        ]
      : [
          { ...counterLine, side: 'debit' as const },
          { ...settlementLine, side: 'credit' as const },
        ]

  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    householdMemberId: params.householdMemberId,
    lines,
    links: [{ toEntryId: params.targetEntryId, linkType: 'settles', amount: params.amount }],
  }
}
