import type { CreateJournalEntryInput } from '../journal/JournalEntry'

export interface BuildCounterpartyExpenseSplittingJournalEntryInputParams {
  /** 按分対象の元の支出仕訳(食費等)のid。allocatesリンクのto_entryとなる */
  originalEntryId: number
  /** 付け替え対象の費用科目(元仕訳と同じ科目)のid */
  expenseAccountId: number
  /** 立替金(資産)科目のid */
  advanceAssetAccountId: number
  /** 支出を立て替えた世帯メンバーのhousehold_member_id */
  payerMemberId: number
  /** 精算待ちの相手(世帯外)のcounterparty_id */
  counterpartyId: number
  /** 割勘バッチを表すproject_id(kind = 'settlement') */
  projectId: number
  amount: number
  entryDate: string
  memo?: string | null
}

/**
 * 世帯外の相手との割勘仕訳(docs/domain/expense-splitting.md 1.4節)を生成する純粋関数。
 * 相手側の負債は家計簿の管理範囲外のため、立替金の資産側のみを使い、費用側の行に
 * counterparty_idを付与する2行仕訳を組み立てる。household_member_id間の負債側立替金
 * (buildHouseholdMemberExpenseSplittingJournalEntryInputのadvanceLiabilityAccountId相当)は
 * 発生しない。JournalEntryRepository.create()にそのまま渡せるCreateJournalEntryInput
 * (source_typeは既定の'manual'のまま)を返す。科目id・counterparty_id・project_idの解決は
 * 呼び出し側の責務。
 *
 * 返り値のlinksに元仕訳へのallocatesリンクを含めることで、割勘仕訳自体の作成と
 * allocatesリンクの作成を単一のDBトランザクションにする(docs/domain/journal.md 1.8参照)。
 */
export function buildCounterpartyExpenseSplittingJournalEntryInput(
  params: BuildCounterpartyExpenseSplittingJournalEntryInputParams,
): CreateJournalEntryInput {
  return {
    entryDate: params.entryDate,
    memo: params.memo ?? null,
    lines: [
      {
        accountId: params.advanceAssetAccountId,
        householdMemberId: params.payerMemberId,
        projectId: params.projectId,
        side: 'debit',
        amount: params.amount,
      },
      {
        accountId: params.expenseAccountId,
        householdMemberId: params.payerMemberId,
        counterpartyId: params.counterpartyId,
        side: 'credit',
        amount: params.amount,
      },
    ],
    links: [{ toEntryId: params.originalEntryId, linkType: 'allocates', amount: params.amount }],
  }
}
