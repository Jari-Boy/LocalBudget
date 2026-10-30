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
 * 個別に組み立てたCreateJournalEntryInputの配列を受け取り、明細行を1つの配列に結合し、
 * allocatesリンクは(計画Issue #132で明細行単位になったため)各inputのfrom_line位置
 * (fromLineIndex)を結合後の行位置へずらして、リンクごとにそのまま引き継ぐ。DB非依存、
 * 外部依存なし。
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
const PROJECT_ID = 26
const ORIGINAL_LINE_ID_1 = 901
const ORIGINAL_LINE_ID_2 = 902

describe('mergeExpenseSplittingJournalEntryInputs', () => {
  it('複数のCreateJournalEntryInputの明細行を1つの配列に結合する', () => {
    const memberInput = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-09-06',
    })
    const counterpartyInput = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
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
    expect(merged.lines).toEqual([...memberInput.lines, ...counterpartyInput.lines])
  })

  it('各inputのallocatesリンクは、結合後の行位置を指すようfromLineIndexをinputごとの行数分だけずらして引き継ぐ', () => {
    const memberInput = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-09-06',
    })
    const counterpartyInput = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 300,
      entryDate: '2026-09-06',
    })

    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [memberInput, counterpartyInput],
      entryDate: '2026-09-06',
      memo: null,
      householdMemberId: MEMBER_A,
    })

    // 世帯メンバー分(4行)のfrom_lineは[2]のまま、世帯外相手分(2行)のfrom_lineは4行ぶんずれて[5]になる
    expect(merged.links).toEqual([
      { fromLineIndex: 2, toLineId: ORIGINAL_LINE_ID_1, linkType: 'allocates', amount: 500 },
      { fromLineIndex: 5, toLineId: ORIGINAL_LINE_ID_1, linkType: 'allocates', amount: 300 },
    ])
    // ずらしたfromLineIndexは、結合後の配列で費用の貸方行(元のfrom_line)を指している
    for (const link of merged.links ?? []) {
      expect(merged.lines[link.fromLineIndex]).toMatchObject({ accountId: EXPENSE_ACCOUNT_ID, side: 'credit' })
    }
  })

  it('元仕訳が複数ある場合、元仕訳の費用行ごとに独立したallocatesリンクを保持する', () => {
    const inputForEntry1 = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-09-06',
    })
    const inputForEntry2 = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_2,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 250,
      entryDate: '2026-09-06',
    })

    const merged = mergeExpenseSplittingJournalEntryInputs({
      inputs: [inputForEntry1, inputForEntry2],
      entryDate: '2026-09-06',
      memo: null,
      householdMemberId: MEMBER_A,
    })

    expect(merged.links).toEqual([
      { fromLineIndex: 1, toLineId: ORIGINAL_LINE_ID_1, linkType: 'allocates', amount: 500 },
      { fromLineIndex: 3, toLineId: ORIGINAL_LINE_ID_2, linkType: 'allocates', amount: 250 },
    ])
  })

  it('inputsが1件のみの場合でも、entryDate・memo・householdMemberIdの上書きを適用した1件の仕訳を返す', () => {
    const singleInput = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID_1,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
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
    expect(merged.links).toEqual([
      { fromLineIndex: 1, toLineId: ORIGINAL_LINE_ID_1, linkType: 'allocates', amount: 500 },
    ])
  })
})
