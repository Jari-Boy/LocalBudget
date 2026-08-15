/**
 * expenseSplittingFormParticipant(割勘起票フォームの分担者行ロジック)の
 * 純粋関数としてのユニットテスト。calculateParticipantAmounts(均等割/カスタム比率の
 * 按分計算)・toExpenseSplitRecipients(フォーム行からrecipients配列への変換、
 * 不完全な行の除外)・toExpenseSplitRecipientsForEntryAmount(複数の元仕訳をまとめて
 * 割勘する場合に、共通の分担者設定を元仕訳ごとの金額へ個別に適用する変換、計画Issue #40
 * 再実装分)を検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  calculateParticipantAmounts,
  createEmptyParticipantRow,
  toExpenseSplitRecipients,
  toExpenseSplitRecipientsForEntryAmount,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'

function row(overrides: Partial<ExpenseSplittingParticipantRow> & { key: number }): ExpenseSplittingParticipantRow {
  return { ...createEmptyParticipantRow(overrides.key), ...overrides }
}

describe('calculateParticipantAmounts', () => {
  it('均等割モードでは、立替者を含めた人数で均等に按分し、端数は結果に含まれる立替者側に寄る', () => {
    const participants = [row({ key: 1 }), row({ key: 2 })]

    const result = calculateParticipantAmounts(1000, participants, 'equal')

    // 立替者+2人=3人均等割: 分担者2人は333円ずつ、立替者(payer)が端数込みの334円
    expect(result.get('1')).toBe(333)
    expect(result.get('2')).toBe(333)
    expect(result.get('payer')).toBe(334)
  })

  it('カスタム比率モードでは、分担者の比率を総額に対する割合として扱い、立替者は残りを負担する', () => {
    const participants = [row({ key: 1, ratioInput: '30' })]

    const result = calculateParticipantAmounts(1000, participants, 'ratio')

    expect(result.get('1')).toBe(300)
    expect(result.get('payer')).toBe(700)
  })

  it('カスタム比率の合計が100を超える場合、立替者の比率は0として扱う(マイナスにしない)', () => {
    const participants = [row({ key: 1, ratioInput: '70' }), row({ key: 2, ratioInput: '50' })]

    const result = calculateParticipantAmounts(1000, participants, 'ratio')

    expect(result.get('payer')).toBe(0)
  })

  it('比率未入力の分担者は重み0として扱われる', () => {
    const participants = [row({ key: 1, ratioInput: '' }), row({ key: 2, ratioInput: '40' })]

    const result = calculateParticipantAmounts(1000, participants, 'ratio')

    expect(result.get('1')).toBe(0)
    expect(result.get('2')).toBe(400)
  })
})

describe('toExpenseSplitRecipients', () => {
  it('世帯メンバー・世帯外相手の行を、それぞれ対応するrecipient種別へ変換する', () => {
    const participants = [
      row({ key: 1, kind: 'householdMember', targetId: 101, amountInput: '300' }),
      row({ key: 2, kind: 'counterparty', targetId: 7, amountInput: '200' }),
    ]

    const result = toExpenseSplitRecipients(participants, 21)

    expect(result).toEqual([
      { kind: 'householdMember', toMemberId: 101, advanceLiabilityAccountId: 21, amount: 300 },
      { kind: 'counterparty', counterpartyId: 7, amount: 200 },
    ])
  })

  it('相手が未選択の行は除外する', () => {
    const participants = [row({ key: 1, kind: 'householdMember', targetId: null, amountInput: '300' })]

    const result = toExpenseSplitRecipients(participants, 21)

    expect(result).toEqual([])
  })

  it('金額が未入力・0以下の行は除外する', () => {
    const participants = [
      row({ key: 1, kind: 'householdMember', targetId: 101, amountInput: '' }),
      row({ key: 2, kind: 'householdMember', targetId: 102, amountInput: '0' }),
    ]

    const result = toExpenseSplitRecipients(participants, 21)

    expect(result).toEqual([])
  })

  it('立替金(負債)科目が未選択の場合、世帯メンバー宛の行は除外する(世帯外相手は影響を受けない)', () => {
    const participants = [
      row({ key: 1, kind: 'householdMember', targetId: 101, amountInput: '300' }),
      row({ key: 2, kind: 'counterparty', targetId: 7, amountInput: '200' }),
    ]

    const result = toExpenseSplitRecipients(participants, null)

    expect(result).toEqual([{ kind: 'counterparty', counterpartyId: 7, amount: 200 }])
  })
})

describe('toExpenseSplitRecipientsForEntryAmount', () => {
  it('amountInputは使わず、渡された元仕訳自身の金額をもとに按分額を計算してrecipientへ変換する', () => {
    const participants = [row({ key: 1, kind: 'householdMember', targetId: 101, amountInput: '9999' })]

    const result = toExpenseSplitRecipientsForEntryAmount(participants, 21, 1000, 'equal')

    // amountInput(9999)は無視され、entryAmount(1000)を立替者+分担者1人で均等割った500が使われる
    expect(result).toEqual([{ kind: 'householdMember', toMemberId: 101, advanceLiabilityAccountId: 21, amount: 500 }])
  })

  it('カスタム比率モードでは、渡された元仕訳自身の金額に対する比率で按分する', () => {
    const participants = [row({ key: 1, kind: 'counterparty', targetId: 7, ratioInput: '30' })]

    const result = toExpenseSplitRecipientsForEntryAmount(participants, null, 500, 'ratio')

    expect(result).toEqual([{ kind: 'counterparty', counterpartyId: 7, amount: 150 }])
  })

  it('相手が未選択の行は除外する', () => {
    const participants = [row({ key: 1, targetId: null })]

    const result = toExpenseSplitRecipientsForEntryAmount(participants, 21, 1000, 'equal')

    expect(result).toEqual([])
  })

  it('立替金(負債)科目が未選択の場合、世帯メンバー宛の行は除外する(世帯外相手は影響を受けない)', () => {
    const participants = [
      row({ key: 1, kind: 'householdMember', targetId: 101 }),
      row({ key: 2, kind: 'counterparty', targetId: 7 }),
    ]

    const result = toExpenseSplitRecipientsForEntryAmount(participants, null, 1000, 'equal')

    // 立替者+分担者2人の均等割: 333円ずつ(端数1円は立替者に寄る)
    expect(result).toEqual([{ kind: 'counterparty', counterpartyId: 7, amount: 333 }])
  })
})
