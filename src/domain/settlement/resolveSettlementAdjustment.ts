import type { AccountCategory } from '../account/Account'

export interface SettlementAdjustment {
  /**
   * buildSettlementJournalEntryInputのsettlementAccountCategoryに渡す値。一時勘定行の
   * 借方/貸方を正しい向きにするためのものであり、科目自体の区分を変更するものではない。
   */
  effectiveCategory: Extract<AccountCategory, 'asset' | 'liability'>
  amount: number
  isGain: boolean
}

/**
 * 精算画面(計画Issue #139)で、選択した仕訳群の合計とバッチ残高の差額をどちらの損益科目
 * (雑収入/雑損失)にどちらの借方/貸方で計上するかを決定する純粋関数。
 *
 * diffは「選択した仕訳群の合計 - バッチ残高」(選択合計が残高より多ければ正)。一時勘定の
 * 実際の区分(資産/負債)によって、同じ符号のdiffでも損益の向きが反転する。
 * - 資産(立替金、相手が我々に返済する立場): diff > 0(多く受け取った)は雑収入。
 *   diff < 0(少なく受け取り、残りを放棄した)は雑損失。
 * - 負債(未払金、我々が返済する立場): diff < 0(少なく払い、残りを免除された)は雑収入。
 *   diff > 0(多く払った、過払い)は雑損失。
 *
 * 判定はisGain = (diff > 0) === (accountCategory === 'asset')で表せる。
 *
 * effectiveCategoryは、調整額を一時勘定行に正しい向きで反映するための値。選択した仕訳群を
 * タグ付けした後に残る実質的な残高(符号付き、calculateSettlementBatchBalanceと同じ増加側を
 * 正とする計算で「バッチ残高 - 選択合計」に相当)が正(まだ残高が残っている方向)なら実際の
 * 区分のまま、負(選択合計が残高を超えて一時勘定が逆方向に振れた)なら区分を反転させることで、
 * buildSettlementJournalEntryInputの既存の借方/貸方ロジックをそのまま再利用できる
 * (docs/domain/settlement.md参照)。DBアクセスなしの純粋関数。
 */
export function resolveSettlementAdjustment(
  diff: number,
  accountCategory: Extract<AccountCategory, 'asset' | 'liability'>,
): SettlementAdjustment {
  const isGain = diff > 0 === (accountCategory === 'asset')
  const effectiveCategory: Extract<AccountCategory, 'asset' | 'liability'> =
    diff < 0 ? accountCategory : accountCategory === 'asset' ? 'liability' : 'asset'

  return { effectiveCategory, amount: Math.abs(diff), isGain }
}
