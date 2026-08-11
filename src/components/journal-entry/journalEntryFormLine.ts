import type { AccountCategory } from '../../domain/account/Account'
import type { JournalLineInput, JournalLineSide } from '../../domain/journal/JournalEntry'
import type {
  JournalEntryDraftLine,
  JournalEntryDraftLineInput,
} from '../../domain/journal/JournalEntryDraft'

/**
 * 仕訳入力フォームの1行分の入力状態(計画Issue #32)。金額は入力途中の値
 * (空文字・非数値を含む)をそのまま保持できるよう文字列で持つ。
 */
export interface JournalEntryFormLine {
  accountId: number | null
  side: JournalLineSide | null
  amountInput: string
  projectId: number | null
  householdMemberId: number | null
  counterpartyId: number | null
}

export function createEmptyJournalEntryFormLine(): JournalEntryFormLine {
  return {
    accountId: null,
    side: null,
    amountInput: '',
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
  }
}

/**
 * マニュアル仕訳(source_type = 'manual')ではis_reconcilable = trueの科目(普通預金等)に
 * 直接記帳できない(docs/domain/reconciliation.md 1.2、is_reconcilable資産・負債への
 * 直接記帳の制限。許可されるのはexternal_import/initial_balance/balance_adjustmentのみ)。
 * 選んでも必ずRestrictedAccountPostingErrorになる科目を科目選択の選択肢自体から除外する
 * ための判定関数。
 */
export function isManualEntryEligibleAccount(account: { isReconcilable: boolean | null }): boolean {
  return account.isReconcilable !== true
}

/**
 * 取引先入力欄はPL科目(収益/費用)の行にのみ表示する
 * (docs/domain/journal.md 2.1、counterparty_idはDDLトリガーでもPL科目行に限定される)。
 */
export function isCounterpartyEligibleCategory(category: AccountCategory): boolean {
  return category === 'revenue' || category === 'expense'
}

/**
 * 下書き保存(journalEntryDraft.update)用に変換する。下書きはバランス検証・
 * 必須項目チェックを一切課さないため(docs/domain/journal.md 3章)、
 * 数値に変換できない金額はnullとしてそのまま保存する。
 */
export function toJournalEntryDraftLineInput(
  line: JournalEntryFormLine,
): JournalEntryDraftLineInput {
  const amount = Number(line.amountInput)
  return {
    accountId: line.accountId,
    side: line.side,
    amount: line.amountInput !== '' && Number.isFinite(amount) ? amount : null,
    projectId: line.projectId,
    householdMemberId: line.householdMemberId,
    counterpartyId: line.counterpartyId,
  }
}

/**
 * 確定送信(JournalEntryRepository.create)用に変換する。科目・貸借・正の金額の
 * いずれかが欠けている行は仕訳明細として不完全なためnullを返し、呼び出し側で
 * 送信対象から除外する。これによりUI側は「何が足りないか」を個別に判定・表示せず、
 * 不完全な行を除いた結果として明細不足・貸借不一致になった場合はRepository層の
 * UnbalancedJournalEntryErrorにそのまま委ねる(docs/architecture.md 12章の方針)。
 */
export function toJournalLineInput(line: JournalEntryFormLine): JournalLineInput | null {
  if (line.accountId === null || line.side === null) return null

  const amount = Number(line.amountInput)
  if (line.amountInput === '' || !Number.isFinite(amount) || amount <= 0) return null

  return {
    accountId: line.accountId,
    side: line.side,
    amount,
    projectId: line.projectId,
    householdMemberId: line.householdMemberId,
    counterpartyId: line.counterpartyId,
  }
}

/**
 * 下書き一覧から再開する際、保存済みの下書き行をフォーム行に変換する。
 */
export function fromJournalEntryDraftLine(draftLine: JournalEntryDraftLine): JournalEntryFormLine {
  return {
    accountId: draftLine.accountId,
    side: draftLine.side,
    amountInput: draftLine.amount === null ? '' : String(draftLine.amount),
    projectId: draftLine.projectId,
    householdMemberId: draftLine.householdMemberId,
    counterpartyId: draftLine.counterpartyId,
  }
}
