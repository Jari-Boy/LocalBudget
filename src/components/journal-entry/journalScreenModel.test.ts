/**
 * 仕訳画面(計画Issue #152)の表示ロジックを担う純粋関数 journalScreenModel のユニットテスト。
 * 対象: 貸借の合計と差額・保存できない理由、割勘できない理由の文言、削除の影響の組み立て、
 * 削除後に選ぶ行、定期取引の提案の並びと処理順の制限、科目で絞り込んだときの代表科目と金額。
 * 外部依存なし(DB・DOM非依存、ドメインの型だけを使う)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import {
  buildDeleteImpactNotes,
  describeIncompleteReason,
  describeSplitBlock,
  findIncompleteReason,
  isProposalBlocked,
  matchedAccountIdsOf,
  pickSelectionAfterDelete,
  sortProposalsOldestFirst,
  summarizeBalance,
  toMatchedResultItem,
} from './journalScreenModel'
import type { JournalEntryFormLine } from './journalEntryFormLine'

function formLine(side: 'debit' | 'credit' | null, amountInput: string, accountId: number | null = 1): JournalEntryFormLine {
  return { accountId, side, amountInput, projectId: null, householdMemberId: null, counterpartyId: null }
}

function line(id: number, side: 'debit' | 'credit', accountId: number, amount: number): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
  }
}

function entry(lines: JournalLine[]): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-10-05',
    memo: 'メモ',
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

describe('summarizeBalance', () => {
  it('借方と貸方の合計と差額を返し、一致していれば貸借一致とする', () => {
    const result = summarizeBalance([formLine('debit', '1000'), formLine('credit', '1000')])
    expect(result).toEqual({ debitTotal: 1000, creditTotal: 1000, difference: 0, isBalanced: true })
  })

  it('差額があるときは貸借一致とせず、差額の絶対値を返す', () => {
    const result = summarizeBalance([formLine('debit', '1500'), formLine('credit', '1000')])
    expect(result.isBalanced).toBe(false)
    expect(result.difference).toBe(500)
  })

  it('金額がどちらも0のときは貸借一致とみなさない', () => {
    expect(summarizeBalance([formLine('debit', ''), formLine('credit', '')]).isBalanced).toBe(false)
  })
})

describe('findIncompleteReason', () => {
  it('科目が未選択の行があれば unselectedAccount を返す', () => {
    expect(findIncompleteReason([formLine('debit', '100', null), formLine('credit', '100')])).toBe('unselectedAccount')
  })

  it('金額が0以下または未入力の行があれば invalidAmount を返す', () => {
    expect(findIncompleteReason([formLine('debit', '0'), formLine('credit', '0')])).toBe('invalidAmount')
  })

  it('借方か貸方の行が足りなければ insufficientLines を返す', () => {
    expect(findIncompleteReason([formLine('debit', '100'), formLine('debit', '100')])).toBe('insufficientLines')
  })

  it('貸借が一致しなければ unbalanced を返す', () => {
    expect(findIncompleteReason([formLine('debit', '100'), formLine('credit', '90')])).toBe('unbalanced')
  })

  it('完成していれば null を返す', () => {
    expect(findIncompleteReason([formLine('debit', '100'), formLine('credit', '100')])).toBeNull()
  })

  it('理由ごとに利用者向けの文言を返す', () => {
    expect(describeIncompleteReason('unselectedAccount')).toBe('未選択の科目があります')
    expect(describeIncompleteReason('unbalanced')).toBe('貸借が一致していません')
  })
})

describe('describeSplitBlock', () => {
  it('割勘できない理由ごとに文言を返す', () => {
    expect(describeSplitBlock('is_expense_split_entry')).toBe('割勘で作られた仕訳は割勘できません')
    expect(describeSplitBlock('already_split')).toBe('この仕訳は割勘済みです')
    expect(describeSplitBlock('no_debit_expense_line')).toBe('費用科目の行がないため割勘できません')
  })
})

describe('buildDeleteImpactNotes', () => {
  it('外部明細は取り込み済みの記録も消えることを伝える', () => {
    const notes = buildDeleteImpactNotes({ sourceType: 'external_import', batchNames: [], isRelated: false })
    expect(notes).toEqual(['取り込み済みの記録も消えます。同じCSVを取り込むと、もう一度取り込まれます。'])
  })

  it('定期は提案が再び表示されることを伝える', () => {
    const notes = buildDeleteImpactNotes({ sourceType: 'recurring_generated', batchNames: [], isRelated: false })
    expect(notes).toEqual(['定期取引の提案として、再び表示されることがあります。'])
  })

  it('割勘は取り消され元の仕訳がまた割勘できることを伝える', () => {
    const notes = buildDeleteImpactNotes({ sourceType: 'expense_splitting', batchNames: [], isRelated: false })
    expect(notes).toEqual(['この割勘が取り消され、元の仕訳はまた割勘できるようになります。'])
  })

  it('精算バッチのタグがあればバッチ名つきで残高が変わることを伝える', () => {
    const notes = buildDeleteImpactNotes({ sourceType: 'manual', batchNames: ['旅行', '飲み会'], isRelated: false })
    expect(notes).toEqual(['精算バッチ「旅行」「飲み会」の残高が変わります。'])
  })

  it('関連仕訳のグループに入っていればグループから外れることを伝える', () => {
    const notes = buildDeleteImpactNotes({ sourceType: 'manual', batchNames: [], isRelated: true })
    expect(notes).toEqual(['関連仕訳のグループから外れます。'])
  })

  it('影響が無ければ空配列を返す', () => {
    expect(buildDeleteImpactNotes({ sourceType: 'manual', batchNames: [], isRelated: false })).toEqual([])
  })
})

describe('pickSelectionAfterDelete', () => {
  it('削除した行の次の行を選ぶ', () => {
    expect(pickSelectionAfterDelete([1, 2, 3], 2)).toBe(3)
  })

  it('最後の行を削除したときは一つ前の行を選ぶ', () => {
    expect(pickSelectionAfterDelete([1, 2, 3], 3)).toBe(2)
  })

  it('1件だけだったときは何も選ばない', () => {
    expect(pickSelectionAfterDelete([1], 1)).toBeNull()
  })
})

describe('定期取引の提案の順序', () => {
  const proposals = [
    { ruleId: 2, dueDate: '2026-10-20' },
    { ruleId: 1, dueDate: '2026-11-01' },
    { ruleId: 1, dueDate: '2026-10-01' },
  ]

  it('対象日の古い順に並べる', () => {
    expect(sortProposalsOldestFirst(proposals).map((p) => p.dueDate)).toEqual(['2026-10-01', '2026-10-20', '2026-11-01'])
  })

  it('同じルールにより古い提案が残っていれば処理できない', () => {
    expect(isProposalBlocked(proposals[1], proposals)).toBe(true)
    expect(isProposalBlocked(proposals[2], proposals)).toBe(false)
    expect(isProposalBlocked(proposals[0], proposals)).toBe(false)
  })
})

describe('科目で絞り込んだときの一覧の行', () => {
  const accounts = [
    { id: 1, accountGroupId: 10 },
    { id: 2, accountGroupId: 11 },
    { id: 3, accountGroupId: null },
  ] as Account[]
  const groups = [
    { id: 10, parentGroupId: null },
    { id: 11, parentGroupId: 10 },
  ]
  const nameOf = (id: number) => `科目${id}`

  it('科目の指定が無ければ undefined を返す', () => {
    expect(matchedAccountIdsOf({}, accounts, groups)).toBeUndefined()
  })

  it('科目の指定とグループ配下の科目を集める', () => {
    expect(matchedAccountIdsOf({ accountIds: [3] }, accounts, groups)).toEqual(new Set([3]))
    expect(matchedAccountIdsOf({ accountGroupIds: [10] }, accounts, groups)).toEqual(new Set([1, 2]))
  })

  it('一致した科目の金額を代表として表示する', () => {
    const e = entry([line(1, 'debit', 1, 300), line(2, 'debit', 2, 700), line(3, 'credit', 3, 1000)])
    const item = toMatchedResultItem(e, nameOf, new Set([1]))
    expect(item.amount).toBe(300)
    expect(item.debitSummary).toBe('科目1 ほか1件')
  })

  it('貸方だけが一致したときは貸方側の金額を表示する', () => {
    const e = entry([line(1, 'debit', 1, 1000), line(2, 'credit', 3, 1000)])
    expect(toMatchedResultItem(e, nameOf, new Set([3])).amount).toBe(1000)
  })

  it('指定が無ければ借方合計を表示する', () => {
    const e = entry([line(1, 'debit', 1, 300), line(2, 'debit', 2, 700), line(3, 'credit', 3, 1000)])
    expect(toMatchedResultItem(e, nameOf, undefined).amount).toBe(1000)
  })
})
