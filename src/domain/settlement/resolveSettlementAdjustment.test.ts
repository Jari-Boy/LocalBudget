/**
 * resolveSettlementAdjustment(精算画面(計画Issue #139)で、選択した仕訳群の合計とバッチ残高の
 * 差額をどちらの損益科目(雑収入/雑損失)にどちらの借方/貸方で計上するかを決定する純粋関数)の
 * ユニットテスト。
 *
 * 一時勘定の実際の区分(資産/負債)と、差額の符号(選択合計がバッチ残高より多いか少ないか)の
 * 組み合わせ4パターンすべてで、複式簿記として正しい向きになることを検証する
 * (計画Issue #139の懸念点「具体的な借方・貸方の向きは資産/負債の区分で変わるため、実装時に
 * 正しい複式簿記の向きを検証すること」への対応)。
 *
 * - 資産(立替金、相手が我々に返済する立場): 選択合計 > 残高(多く受け取った)は雑収入、
 *   選択合計 < 残高(少なく受け取り、残りを放棄)は雑損失。
 * - 負債(未払金、我々が返済する立場): 選択合計 < 残高(少なく払い、残りを免除された)は雑収入、
 *   選択合計 > 残高(多く払った、過払い)は雑損失。
 *
 * effectiveCategoryは、buildSettlementJournalEntryInputに渡すことで一時勘定行の借方/貸方を
 * 正しい向きにするための値であり、科目区分そのものを変更するものではない(DBアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import { resolveSettlementAdjustment } from './resolveSettlementAdjustment'

describe('resolveSettlementAdjustment', () => {
  it('資産科目で選択合計がバッチ残高より多い場合、雑収入(gain)。effectiveCategoryはliabilityに反転する', () => {
    const result = resolveSettlementAdjustment(500, 'asset')

    expect(result).toEqual({ effectiveCategory: 'liability', amount: 500, isGain: true })
  })

  it('資産科目で選択合計がバッチ残高より少ない場合、雑損失(loss)。effectiveCategoryは実際の区分(asset)のまま', () => {
    const result = resolveSettlementAdjustment(-500, 'asset')

    expect(result).toEqual({ effectiveCategory: 'asset', amount: 500, isGain: false })
  })

  it('負債科目で選択合計がバッチ残高より少ない場合(残りを免除された)、雑収入(gain)。effectiveCategoryは実際の区分(liability)のまま', () => {
    const result = resolveSettlementAdjustment(-800, 'liability')

    expect(result).toEqual({ effectiveCategory: 'liability', amount: 800, isGain: true })
  })

  it('負債科目で選択合計がバッチ残高より多い場合(過払い)、雑損失(loss)。effectiveCategoryはassetに反転する', () => {
    const result = resolveSettlementAdjustment(800, 'liability')

    expect(result).toEqual({ effectiveCategory: 'asset', amount: 800, isGain: false })
  })
})
