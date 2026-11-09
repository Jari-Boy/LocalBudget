/**
 * mergeExpenseSplittingJournalEntryInputs(複数の割勘仕訳入力を1件の複合仕訳へ統合する)の
 * 純粋関数としてのユニットテスト。人間レビューでの指摘「割勘の仕訳を作るときは、複数明細を
 * まとめて一本で仕訳を切るように(逆仕訳が切りやすくなるから)」を受けて新設した(計画Issue
 * #40)。呼び出し側(ExpenseSplittingForm)は、分担者(kind+targetId)ごとにグルーピングした
 * CreateJournalEntryInputの配列を分担者ごとに1回ずつこの関数に渡す。統合の単位を分担者ごとに
 * 限定しているのは、異なる分担者の立替金(負債)行を同じ仕訳に混在させると精算画面がタグ
 * (account・project・household_member)ごとに残高を区別できなくなる不具合が見つかったため
 * (evaluatorレビュー指摘、docs/decisions.md(2026-09-06)参照)。この関数自体は「渡された
 * 配列を1件に統合する」という汎用の処理のみを担い、分担者ごとのグルーピング自体は
 * 呼び出し側の責務である。buildHouseholdMemberExpenseSplittingJournalEntryInput/
 * buildCounterpartyExpenseSplittingJournalEntryInput(1.3・1.4節の2者間仕訳パターン)が
 * 個別に組み立てたCreateJournalEntryInputの配列を受け取り、明細行を1つの配列に結合する。
 * 元仕訳との関連付け(journal_entry_links)は計画Issue #138で関連仕訳グループに置き換わり、
 * 本関数の責務ではなくなった。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from './buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { buildCounterpartyExpenseSplittingJournalEntryInput } from './buildCounterpartyExpenseSplittingJournalEntryInput'
import { mergeExpenseSplittingJournalEntryInputs } from './mergeExpenseSplittingJournalEntryInputs'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 10
const ADVANCE_LIABILITY_ACCOUNT_ID = 11
const MEMBER_A = 100
const MEMBER_B = 200
const FRIEND_COUNTERPARTY_ID = 300
const SETTLEMENT_BATCH_ID = 26

describe('mergeExpenseSplittingJournalEntryInputs', () => {
  it('複数のCreateJournalEntryInputの明細行を1つの配列に結合する', () => {
    const memberInput = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-09-06',
    })
    const counterpartyInput = buildCounterpartyExpenseSplittingJournalEntryInput({
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 300,
      entryDate: '2026-09-06',
    })

    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [memberInput, counterpartyInput],
      entryDate: '2026-09-06',
      memo: 'カスタム摘要',
      householdMemberId: MEMBER_A,
    })

    expect(merged.entryDate).toBe('2026-09-06')
    expect(merged.memo).toBe('カスタム摘要')
    expect(merged.householdMemberId).toBe(MEMBER_A)
    expect(merged.sourceType).toBe('expense_splitting')
    // 分担者の違う行は結合され、同じ行(支払った本人の食費の貸方など)は合計される。借方・貸方の合計は変わらない
    const concatenated = [...memberInput.lines, ...counterpartyInput.lines]
    const total = (lines: typeof concatenated, side: 'debit' | 'credit') =>
      lines.filter((l) => l.side === side).reduce((sum, l) => sum + l.amount, 0)
    expect(total(merged.lines, 'debit')).toBe(total(concatenated, 'debit'))
    expect(total(merged.lines, 'credit')).toBe(total(concatenated, 'credit'))
    expect(merged.lines.length).toBeLessThan(concatenated.length)
    expect(merged.lines[0]).toEqual(memberInput.lines[0])
  })

  it('inputsが1件のみの場合でも、entryDate・memo・householdMemberIdの上書きを適用した1件の仕訳を返す', () => {
    const singleInput = buildCounterpartyExpenseSplittingJournalEntryInput({
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-07-01',
      memo: '元の仕訳自身が持つ摘要(上書きされるべき)',
    })

    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [singleInput],
      entryDate: '2026-09-06',
      memo: 'ユーザーが入力した摘要',
      householdMemberId: MEMBER_B,
    })

    expect(merged.entryDate).toBe('2026-09-06')
    expect(merged.memo).toBe('ユーザーが入力した摘要')
    expect(merged.householdMemberId).toBe(MEMBER_B)
    expect(merged.lines).toEqual(singleInput.lines)
  })

  it('科目・貸借・世帯メンバー・取引先・精算バッチが同じ明細行は、1行に金額を合計する(同じ相手との複数の支出)', () => {
    const build = (amount: number) =>
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        expenseAccountId: EXPENSE_ACCOUNT_ID,
        advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
        advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        fromMemberId: MEMBER_A,
        toMemberId: MEMBER_B,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        amount,
        entryDate: '2026-09-06',
      })

    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [build(1600), build(2250)],
      entryDate: '2026-09-06',
      memo: null,
      householdMemberId: MEMBER_A,
    })

    // 食費の借方・貸方、立替金の借方、未払金の貸方の4行だけになり、それぞれ合計額になる
    expect(merged.lines).toHaveLength(4)
    expect(merged.lines.map((l) => l.amount)).toEqual([3850, 3850, 3850, 3850])
    expect(merged.lines.find((l) => l.accountId === ADVANCE_ASSET_ACCOUNT_ID)).toMatchObject({
      side: 'debit',
      householdMemberId: MEMBER_A,
      settlementBatchId: SETTLEMENT_BATCH_ID,
    })
  })

  it('科目や世帯メンバーが違う明細行は、合計せずに別の行のまま残す', () => {
    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [
        buildHouseholdMemberExpenseSplittingJournalEntryInput({
          expenseAccountId: EXPENSE_ACCOUNT_ID,
          advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
          advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
          fromMemberId: MEMBER_A,
          toMemberId: MEMBER_B,
          settlementBatchId: SETTLEMENT_BATCH_ID,
          amount: 1000,
          entryDate: '2026-09-06',
        }),
        buildHouseholdMemberExpenseSplittingJournalEntryInput({
          expenseAccountId: 2,
          advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
          advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
          fromMemberId: MEMBER_A,
          toMemberId: 300,
          settlementBatchId: SETTLEMENT_BATCH_ID,
          amount: 500,
          entryDate: '2026-09-06',
        }),
      ],
      entryDate: '2026-09-06',
      memo: null,
      householdMemberId: MEMBER_A,
    })

    // 食費(別科目)の行と、相手が違う立替金・未払金の行は分かれ、立替金は同じメンバーAなので1行になる
    const advance = merged.lines.filter((l) => l.accountId === ADVANCE_ASSET_ACCOUNT_ID)
    expect(advance).toHaveLength(1)
    expect(advance[0].amount).toBe(1500)
    expect(merged.lines.filter((l) => l.accountId === ADVANCE_LIABILITY_ACCOUNT_ID)).toHaveLength(2)
  })
})
