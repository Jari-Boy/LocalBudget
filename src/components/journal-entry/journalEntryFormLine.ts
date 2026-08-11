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
 * マニュアル仕訳(source_type = 'manual')で選択可能な科目かどうかを判定する。
 * - isReconcilable = trueの科目(普通預金等)は直接記帳できない(docs/domain/reconciliation.md
 *   1.2、is_reconcilable資産・負債への直接記帳の制限。許可されるのはexternal_import/
 *   initial_balance/balance_adjustmentのみ)。選ぶと必ずRestrictedAccountPostingErrorになる。
 * - isSystemManaged = trueの科目(初期残高科目・残高調整科目等、docs/domain/accounts.md
 *   フィールド定義)はシステムが内部管理する科目であり、ユーザーが直接選ぶべきではない
 *   (AccountListScreenが一覧表示から除外するのと同じ理由)。この制約はJournalEntryRepository・
 *   DDLトリガーいずれにも存在せず、選ぶとそのまま記帳できてしまい初期残高の整合性が壊れうる
 *   ため、UI側の選択肢除外が事実上唯一の防御手段になる。
 */
export function isManualEntryEligibleAccount(account: {
  isReconcilable: boolean | null
  isSystemManaged: boolean
}): boolean {
  return account.isReconcilable !== true && !account.isSystemManaged
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
 * 金額欄に入力があるにもかかわらず0以下(マイナスまたは0)の場合にtrueを返す。
 * amount > 0のCHECK制約(docs/domain/journal.md 1.4)に反する入力を、確定操作前に
 * 専用のエラーメッセージ(negativeAmountError)で明示的に伝えるための判定。
 * toJournalLineInputは0以下の金額を単に送信対象から除外するだけのため、この判定を
 * 挟まないと、残りの行だけでたまたま貸借が一致した場合にマイナス金額の行が
 * 気づかれないまま確定されてしまう(ユーザーからの指摘により追加)。
 * 未入力(空文字)の行はここでは対象外とし、明細数不足・貸借不一致の判定は
 * 従来通りRepository層(UnbalancedJournalEntryError)に委ねる。
 */
export function hasNonPositiveAmountInput(line: JournalEntryFormLine): boolean {
  if (line.amountInput === '') return false
  const amount = Number(line.amountInput)
  return Number.isFinite(amount) && amount <= 0
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
