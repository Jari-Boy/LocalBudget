/**
 * journalEditorMember(仕訳の詳細パネルで、明細行の世帯メンバーを決める純粋関数、計画Issue #169)のテスト。
 * 明細行の世帯メンバーの既定値は起票者で、科目に既定メンバーがある行はその既定値で固定すること、
 * 科目を変えたときの行のメンバーの扱い、起票者を変えたとき「手で変えていない行」だけが追従することを検証する。
 * 外部依存なしの純粋関数のテスト。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntryFormLine } from './journalEntryFormLine'
import { followBookkeeper, memberAfterAccountChange } from './journalEditorMember'

function formLine(accountId: number | null, householdMemberId: number | null): JournalEntryFormLine {
  return { accountId, side: 'debit', amountInput: '100', projectId: null, householdMemberId, counterpartyId: null }
}

/** 科目1: 既定メンバーなし、科目2: 既定メンバー(9)あり */
const defaultMemberOf = (accountId: number | null): number | null => (accountId === 2 ? 9 : null)

describe('memberAfterAccountChange', () => {
  it('既定メンバーのある科目に変えると、その既定値になる(起票者や元のメンバーによらない)', () => {
    expect(memberAfterAccountChange({ line: formLine(1, 3), newAccountDefault: 9, previousAccountDefault: null, entryMemberId: 3 })).toBe(9)
  })

  it('既定メンバーのない科目に変えたとき、行のメンバーは変えない(手で選んだ値を保つ)', () => {
    expect(memberAfterAccountChange({ line: formLine(1, 4), newAccountDefault: null, previousAccountDefault: null, entryMemberId: 3 })).toBe(4)
  })

  it('既定メンバーのある科目から、ない科目に変えると、固定が外れて起票者になる', () => {
    expect(memberAfterAccountChange({ line: formLine(2, 9), newAccountDefault: null, previousAccountDefault: 9, entryMemberId: 3 })).toBe(3)
  })

  it('メンバーが未設定の行(科目未選択の新しい行など)に科目を選ぶと、起票者になる', () => {
    expect(memberAfterAccountChange({ line: formLine(null, null), newAccountDefault: null, previousAccountDefault: null, entryMemberId: 3 })).toBe(3)
  })
})

describe('followBookkeeper', () => {
  it('旧起票者のままで科目に既定メンバーのない行だけが、新しい起票者に追従する', () => {
    const lines = [
      { key: 1, line: formLine(1, 3) }, // 旧起票者のまま → 追従
      { key: 2, line: formLine(2, 9) }, // 科目の既定で固定 → 動かない
      { key: 3, line: formLine(1, 4) }, // 手で別のメンバーにした → 動かない
    ]

    const result = followBookkeeper(lines, defaultMemberOf, 3, 5)

    expect(result.map((l) => l.line.householdMemberId)).toEqual([5, 9, 4])
  })

  it('起票者が変わらなければ、何も変えない', () => {
    const lines = [{ key: 1, line: formLine(1, 3) }]
    expect(followBookkeeper(lines, defaultMemberOf, 3, 3)).toBe(lines)
  })

  it('メンバーが未設定の行(下書きの未入力)も、新しい起票者に追従する', () => {
    const lines = [{ key: 1, line: formLine(1, null) }]
    expect(followBookkeeper(lines, defaultMemberOf, 3, 5)[0].line.householdMemberId).toBe(5)
  })

  it('新しい起票者が未選択(null)のときは、何も変えない', () => {
    const lines = [{ key: 1, line: formLine(1, 3) }]
    expect(followBookkeeper(lines, defaultMemberOf, 3, null)).toBe(lines)
  })
})
