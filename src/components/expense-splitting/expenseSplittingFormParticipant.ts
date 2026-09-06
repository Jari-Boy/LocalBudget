import type { ExpenseSplitRecipient } from '../../domain/expense-splitting/buildExpenseSplittingJournalEntryInputs'
import { allocateExpenseSplitAmounts } from '../../domain/expense-splitting/allocateExpenseSplitAmounts'

export type ExpenseSplittingAllocationMode = 'equal' | 'ratio' | 'amount'

/**
 * 割勘起票フォームの分担者1行分の入力状態(計画Issue #40)。kindは行の由来
 * (世帯メンバー一覧のチェックボックスから選ばれたか、世帯外の相手として追加されたか)
 * によって一意に決まり、ユーザーが「相手の種類」として明示的に選択するものではない
 * (人間レビューでの指摘、計画Issue #40再実装分。ExpenseSplittingForm参照)。
 * 配分方法(equal/ratio)では計算結果をamountInputへ反映して表示し、amountでは
 * ユーザーが直接amountInputへ入力する(いずれも確定前に手動修正できる)。
 */
export interface ExpenseSplittingParticipantRow {
  key: number
  kind: 'householdMember' | 'counterparty'
  targetId: number | null
  ratioInput: string
  amountInput: string
}

const PAYER_KEY = 'payer'

/**
 * 均等割/カスタム比率モードで、立替者+分担者の按分額を計算する。均等割は全員の
 * weightを1として扱う。カスタム比率は各分担者のratioInputを「総額に対する
 * パーセンテージ」として扱い、立替者の取り分は残りの割合(100 - 分担者比率の合計)を
 * weightとする(分担者の比率だけを立替者と同列のweightにすると、比率入力が
 * 総額に対する割合という直感と食い違うため)。allocateExpenseSplitAmounts
 * (端数は立替者に寄せる)へ委譲し、結果を「行key文字列 → 金額」のMapとして返す
 * (amountモードでは呼び出し側で使わない)。
 */
export function calculateParticipantAmounts(
  totalAmount: number,
  participants: readonly ExpenseSplittingParticipantRow[],
  mode: ExpenseSplittingAllocationMode,
): Map<string, number> {
  if (mode === 'ratio') {
    const participantRatioSum = participants.reduce((sum, row) => sum + (Number(row.ratioInput) || 0), 0)
    const shares = [
      { key: PAYER_KEY, weight: Math.max(0, 100 - participantRatioSum) },
      ...participants.map((row) => ({ key: String(row.key), weight: Number(row.ratioInput) || 0 })),
    ]
    return allocateExpenseSplitAmounts(totalAmount, shares, PAYER_KEY)
  }
  const shares = [
    { key: PAYER_KEY, weight: 1 },
    ...participants.map((row) => ({ key: String(row.key), weight: 1 })),
  ]
  return allocateExpenseSplitAmounts(totalAmount, shares, PAYER_KEY)
}

/**
 * 分担者行から、buildExpenseSplittingJournalEntryInputsへ渡すrecipients配列を組み立てる。
 * targetId未選択または金額が0以下の行は不完全な入力として除外する
 * (JournalEntryFormのtoJournalLineInputと同じ「不完全な行は送信対象から除外する」方針)。
 * 単一の元仕訳を割勘する場合に使う。amountInput(確定前に手動修正できるプレビュー欄)を
 * そのまま金額として使うため、ユーザーによる直接編集が確定額に反映される。
 */
export function toExpenseSplitRecipients(
  participants: readonly ExpenseSplittingParticipantRow[],
  advanceLiabilityAccountId: number | null,
): ExpenseSplitRecipient[] {
  const recipients: ExpenseSplitRecipient[] = []
  for (const row of participants) {
    if (row.targetId === null) continue
    const amount = Number(row.amountInput)
    if (row.amountInput === '' || !Number.isFinite(amount) || amount <= 0) continue

    if (row.kind === 'householdMember') {
      if (advanceLiabilityAccountId === null) continue
      recipients.push({
        kind: 'householdMember',
        toMemberId: row.targetId,
        advanceLiabilityAccountId,
        amount,
      })
    } else {
      recipients.push({ kind: 'counterparty', counterpartyId: row.targetId, amount })
    }
  }
  return recipients
}

/**
 * 複数の元仕訳をまとめて割勘する場合に、分担者行から特定の元仕訳1件分のrecipients配列を
 * 組み立てる。元仕訳ごとに金額が異なるため、amountInput(複数の元仕訳の合計を表示する
 * プレビュー欄、ExpenseSplittingForm参照)は使わず、共通の分担者設定(kind/targetId/
 * ratioInput)をentryAmount(その元仕訳自身の金額)に対してcalculateParticipantAmountsで
 * 都度計算し直す。手動編集可能なプレビューは単一の元仕訳を割勘する場合のみ提供する
 * (計画Issue #40、複数元仕訳の一括割勘対応)。
 */
export function toExpenseSplitRecipientsForEntryAmount(
  participants: readonly ExpenseSplittingParticipantRow[],
  advanceLiabilityAccountId: number | null,
  entryAmount: number,
  mode: ExpenseSplittingAllocationMode,
): ExpenseSplitRecipient[] {
  const amounts = calculateParticipantAmounts(entryAmount, participants, mode)
  const recipients: ExpenseSplitRecipient[] = []
  for (const row of participants) {
    if (row.targetId === null) continue
    const amount = amounts.get(String(row.key)) ?? 0
    if (amount <= 0) continue

    if (row.kind === 'householdMember') {
      if (advanceLiabilityAccountId === null) continue
      recipients.push({
        kind: 'householdMember',
        toMemberId: row.targetId,
        advanceLiabilityAccountId,
        amount,
      })
    } else {
      recipients.push({ kind: 'counterparty', counterpartyId: row.targetId, amount })
    }
  }
  return recipients
}
