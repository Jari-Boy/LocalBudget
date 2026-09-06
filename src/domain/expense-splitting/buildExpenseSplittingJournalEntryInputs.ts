import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import {
  buildCounterpartyExpenseSplittingJournalEntryInput,
} from './buildCounterpartyExpenseSplittingJournalEntryInput'
import {
  buildHouseholdMemberExpenseSplittingJournalEntryInput,
} from './buildHouseholdMemberExpenseSplittingJournalEntryInput'

export type ExpenseSplitRecipient =
  | { kind: 'householdMember'; toMemberId: number; advanceLiabilityAccountId: number; amount: number }
  | { kind: 'counterparty'; counterpartyId: number; amount: number }

export interface BuildExpenseSplittingJournalEntryInputsParams {
  /** 按分対象の元の支出仕訳のid。全分担者の仕訳がこれをallocatesリンクのto_entryとする */
  originalEntryId: number
  expenseAccountId: number
  advanceAssetAccountId: number
  /** 元々の支出者(立替者)のhousehold_member_id。分担者リストには含めない */
  fromMemberId: number
  projectId: number
  entryDate: string
  memo?: string | null
  recipients: readonly ExpenseSplitRecipient[]
}

/**
 * 複数人割勘の仕訳配列組み立て(計画Issue #40、比率変更・複数人対応)。分担者
 * (世帯メンバー/世帯外相手の混在可)ごとに、既存の
 * buildHouseholdMemberExpenseSplittingJournalEntryInput/
 * buildCounterpartyExpenseSplittingJournalEntryInput(いずれもdocs/domain/expense-splitting.md
 * 1.3・1.4節の2者間仕訳パターン)へ振り分けて呼び出し、CreateJournalEntryInputの配列を返す
 * 薄い合成関数。ドメイン仕様(1.3・1.4節)自体・仕訳パターンは変更せず、「立替者から
 * 分担者の人数分だけ2者間仕訳を繰り返す」ことで複数人割勘を表現する(単一の可変長仕訳
 * パターンは採用しない、計画Issue #40の合意事項)。各要素の作成(Repository呼び出し)は
 * 呼び出し側の責務。
 */
export function buildExpenseSplittingJournalEntryInputs(
  params: BuildExpenseSplittingJournalEntryInputsParams,
): CreateJournalEntryInput[] {
  return params.recipients.map((recipient) =>
    recipient.kind === 'householdMember'
      ? buildHouseholdMemberExpenseSplittingJournalEntryInput({
          originalEntryId: params.originalEntryId,
          expenseAccountId: params.expenseAccountId,
          advanceAssetAccountId: params.advanceAssetAccountId,
          advanceLiabilityAccountId: recipient.advanceLiabilityAccountId,
          fromMemberId: params.fromMemberId,
          toMemberId: recipient.toMemberId,
          projectId: params.projectId,
          amount: recipient.amount,
          entryDate: params.entryDate,
          memo: params.memo,
        })
      : buildCounterpartyExpenseSplittingJournalEntryInput({
          originalEntryId: params.originalEntryId,
          expenseAccountId: params.expenseAccountId,
          advanceAssetAccountId: params.advanceAssetAccountId,
          payerMemberId: params.fromMemberId,
          counterpartyId: recipient.counterpartyId,
          projectId: params.projectId,
          amount: recipient.amount,
          entryDate: params.entryDate,
          memo: params.memo,
        }),
  )
}
