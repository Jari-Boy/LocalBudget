/**
 * 明細行単位の表の一括編集(計画Issue #182)の純粋関数のユニットテスト。
 * 選択した行と科目の選択から「選べる項目」を先に決める(取引先は費用・収益の科目だけ、精算バッチはシステム管理の
 * 立替金・未払金だけ、世帯メンバーは既定メンバーのない科目だけ。科目を一括で変えるときは変更後の科目で判断する)、
 * 選べなくなった項目の選択を外す、選択の件数(行・借方・貸方・仕訳)、更新内容の組み立て(仕訳ごとの更新入力。
 * 選択した行だけが変わり、行のid・精算バッチのタグなど他の項目は保たれる。科目を変えたときは持てない取引先・
 * 精算バッチが外れ、世帯メンバーは既定 > 手で選んだ値の規則)、変更内容の表示文を検証する。
 * 外部依存なし(DB・DOMに触れない)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import {
  EMPTY_BULK_PICK,
  bulkEditRules,
  buildBulkUpdates,
  isBulkPickEmpty,
  sanitizeBulkPick,
  selectionStats,
  summarizeBulkEdit,
  type BulkPick,
  type BulkSelectedLine,
} from './journalBulkEditModel'

function account(id: number, name: string, category: Account['category'], extra: Partial<Account> = {}): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

const FOOD = account(1, '食費', 'expense')
const SALARY = account(2, '給与収入', 'revenue')
const BANK = account(3, '普通預金', 'asset')
const ADVANCE = account(4, '立替金', 'asset', { isSystemManaged: true })
const PHONE = account(5, '携帯代(妻)', 'expense', { householdMemberId: 2 })
const accountById = new Map([FOOD, SALARY, BANK, ADVANCE, PHONE].map((a) => [a.id, a]))

function line(id: number, entryId: number, side: 'debit' | 'credit', accountId: number, amount: number, extra: Partial<JournalLine> = {}): JournalLine {
  return {
    id,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
    ...extra,
  }
}

function entry(id: number, lines: JournalLine[], extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    entryDate: '2026-11-10',
    memo: `仕訳${id}`,
    comment: 'コメント',
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
    ...extra,
  }
}

// 仕訳1: 食費(借)1000 / 普通預金(貸)1000 ・ 仕訳2: 立替金(借)500(精算バッチ7) / 給与収入(貸)500(取引先9)
const e1 = entry(1, [line(11, 1, 'debit', 1, 1000, { projectId: 3, counterpartyId: 8 }), line(12, 1, 'credit', 3, 1000)])
const e2 = entry(2, [line(21, 2, 'debit', 4, 500, { settlementBatchId: 7 }), line(22, 2, 'credit', 2, 500, { counterpartyId: 9 })])

const sel = (entryObj: JournalEntry, lineId: number): BulkSelectedLine => ({
  entry: entryObj,
  line: entryObj.lines.find((l) => l.id === lineId) as JournalLine,
})

const pickWith = (patch: Partial<BulkPick>): BulkPick => ({ ...EMPTY_BULK_PICK, ...patch })

describe('bulkEditRules(選べる項目)', () => {
  it('選んだ行がすべて費用・収益の科目なら、取引先を選べる(精算バッチは選べない)', () => {
    const rules = bulkEditRules([sel(e1, 11), sel(e2, 22)], EMPTY_BULK_PICK, accountById)
    expect(rules.counterpartyAllowed).toBe(true)
    expect(rules.batchAllowed).toBe(false)
    expect(rules.batchBlockedBy).toEqual(['食費', '給与収入'])
  })

  it('資産の科目(普通預金)の行が混ざると取引先は選べず、その科目名を理由に挙げる', () => {
    const rules = bulkEditRules([sel(e1, 11), sel(e1, 12)], EMPTY_BULK_PICK, accountById)
    expect(rules.counterpartyAllowed).toBe(false)
    expect(rules.counterpartyBlockedBy).toEqual(['普通預金'])
  })

  it('科目を費用・収益の科目に一括で変えるときは、資産の行が混ざっていても取引先を選べる', () => {
    const rules = bulkEditRules([sel(e1, 11), sel(e1, 12)], pickWith({ accountId: 1 }), accountById)
    expect(rules.counterpartyAllowed).toBe(true)
  })

  it('選んだ行がすべて立替金・未払金(システム管理の資産・負債)なら精算バッチを選べる', () => {
    const rules = bulkEditRules([sel(e2, 21)], EMPTY_BULK_PICK, accountById)
    expect(rules.batchAllowed).toBe(true)
    expect(rules.counterpartyAllowed).toBe(false)
  })

  it('立替金の行に食費の行が混ざると精算バッチは選べない', () => {
    const rules = bulkEditRules([sel(e2, 21), sel(e1, 11)], EMPTY_BULK_PICK, accountById)
    expect(rules.batchAllowed).toBe(false)
    expect(rules.batchBlockedBy).toEqual(['食費'])
  })

  it('科目をバッチ専用の科目(立替金)に一括で変えるときは、食費の行が混ざっていても精算バッチを選べる', () => {
    const rules = bulkEditRules([sel(e1, 11), sel(e2, 21)], pickWith({ accountId: 4 }), accountById)
    expect(rules.batchAllowed).toBe(true)
    expect(rules.counterpartyAllowed).toBe(false)
  })

  it('既定の世帯メンバーがある科目の行を含むと、世帯メンバーは選べない', () => {
    const phone = entry(3, [line(31, 3, 'debit', 5, 300, { householdMemberId: 2 }), line(32, 3, 'credit', 3, 300)])
    const rules = bulkEditRules([sel(phone, 31)], EMPTY_BULK_PICK, accountById)
    expect(rules.memberAllowed).toBe(false)
    expect(rules.memberBlockedBy).toEqual(['携帯代(妻)'])
  })

  it('科目を既定メンバーのある科目に一括で変えるときも、世帯メンバーは選べない。ない科目なら選べる', () => {
    expect(bulkEditRules([sel(e1, 11)], pickWith({ accountId: 5 }), accountById).memberAllowed).toBe(false)
    expect(bulkEditRules([sel(e1, 11)], pickWith({ accountId: 1 }), accountById).memberAllowed).toBe(true)
  })

  it('何も選んでいない(0行)ときは、どの項目も選べない', () => {
    const rules = bulkEditRules([], EMPTY_BULK_PICK, accountById)
    expect(rules).toMatchObject({ counterpartyAllowed: false, batchAllowed: false, memberAllowed: false })
  })
})

describe('sanitizeBulkPick(選べなくなった項目の選択を外す)', () => {
  it('選べない項目の選択だけが「変更しない」に戻り、選べる項目・科目・プロジェクトの選択は残る', () => {
    const pick = pickWith({
      accountId: 3,
      project: { kind: 'set', value: 5 },
      counterparty: { kind: 'set', value: 8 },
      batch: { kind: 'clear' },
      memberId: 2,
    })
    const rules = bulkEditRules([sel(e1, 11)], pick, accountById)
    const next = sanitizeBulkPick(pick, rules)
    expect(next.accountId).toBe(3)
    expect(next.project).toEqual({ kind: 'set', value: 5 })
    expect(next.counterparty).toEqual({ kind: 'keep' })
    expect(next.batch).toEqual({ kind: 'keep' })
    expect(next.memberId).toBe(2)
  })
})

describe('isBulkPickEmpty', () => {
  it('何も選んでいなければtrue、1項目でも選べばfalse', () => {
    expect(isBulkPickEmpty(EMPTY_BULK_PICK)).toBe(true)
    expect(isBulkPickEmpty(pickWith({ project: { kind: 'clear' } }))).toBe(false)
    expect(isBulkPickEmpty(pickWith({ accountId: 1 }))).toBe(false)
    expect(isBulkPickEmpty(pickWith({ memberId: 1 }))).toBe(false)
  })
})

describe('selectionStats', () => {
  it('行数・借方の行数・貸方の行数・仕訳の件数を数える(同じ仕訳の2行は1件)', () => {
    const stats = selectionStats([sel(e1, 11), sel(e1, 12), sel(e2, 21)])
    expect(stats).toEqual({ lineCount: 3, debitCount: 2, creditCount: 1, entryCount: 2 })
  })
})

describe('buildBulkUpdates(更新内容の組み立て)', () => {
  it('何も選んでいなければ、更新はない', () => {
    expect(buildBulkUpdates([sel(e1, 11)], EMPTY_BULK_PICK, accountById)).toEqual([])
  })

  it('仕訳ごとに1件の更新になり、選択した行だけが変わる(他の行はそのまま、行のidは保つ)', () => {
    const updates = buildBulkUpdates([sel(e1, 11), sel(e2, 21)], pickWith({ project: { kind: 'set', value: 99 } }), accountById)
    expect(updates.map((u) => u.entry.id)).toEqual([1, 2])
    const [u1, u2] = updates
    expect(u1.input.lines.map((l) => [l.id, l.projectId])).toEqual([
      [11, 99],
      [12, null],
    ])
    expect(u2.input.lines.map((l) => [l.id, l.projectId])).toEqual([
      [21, 99],
      [22, null],
    ])
  })

  it('同じ仕訳の複数行を選んでも、その仕訳の更新は1件にまとまる', () => {
    const updates = buildBulkUpdates([sel(e1, 11), sel(e1, 12)], pickWith({ project: { kind: 'set', value: 99 } }), accountById)
    expect(updates).toHaveLength(1)
    expect(updates[0].input.lines.map((l) => l.projectId)).toEqual([99, 99])
  })

  it('取引日・摘要・コメントはそのまま、起票者は指定しない(既存を維持)', () => {
    const [update] = buildBulkUpdates([sel(e1, 11)], pickWith({ project: { kind: 'clear' } }), accountById)
    expect(update.input).toMatchObject({ entryDate: '2026-11-10', memo: '仕訳1', comment: 'コメント' })
    expect(update.input.householdMemberId).toBeUndefined()
  })

  it('プロジェクト・取引先は「なし(外す)」でnullにできる', () => {
    const [update] = buildBulkUpdates(
      [sel(e1, 11)],
      pickWith({ project: { kind: 'clear' }, counterparty: { kind: 'clear' } }),
      accountById,
    )
    expect(update.input.lines[0]).toMatchObject({ id: 11, projectId: null, counterpartyId: null })
  })

  it('取引先を設定できる(費用・収益の行)。他の行の取引先は変わらない', () => {
    const [update] = buildBulkUpdates([sel(e1, 11)], pickWith({ counterparty: { kind: 'set', value: 55 } }), accountById)
    expect(update.input.lines[0].counterpartyId).toBe(55)
    expect(update.input.lines[1].counterpartyId).toBeNull()
  })

  it('精算バッチを設定・外せる(立替金の行)。他の行のタグは保たれる', () => {
    const [set] = buildBulkUpdates([sel(e2, 21)], pickWith({ batch: { kind: 'set', value: 77 } }), accountById)
    expect(set.input.lines[0].settlementBatchId).toBe(77)
    const [cleared] = buildBulkUpdates([sel(e2, 21)], pickWith({ batch: { kind: 'clear' } }), accountById)
    expect(cleared.input.lines[0].settlementBatchId).toBeNull()
  })

  it('選択していない行の精算バッチ・取引先は、そのまま保たれる', () => {
    const [update] = buildBulkUpdates([sel(e2, 21)], pickWith({ project: { kind: 'set', value: 1 } }), accountById)
    expect(update.input.lines[0].settlementBatchId).toBe(7)
    expect(update.input.lines[1].counterpartyId).toBe(9)
  })

  it('世帯メンバーを設定すると、選択した行の世帯メンバーが変わる', () => {
    const [update] = buildBulkUpdates([sel(e1, 11)], pickWith({ memberId: 2 }), accountById)
    expect(update.input.lines.map((l) => l.householdMemberId)).toEqual([2, 1])
  })

  it('科目を変えると、新しい科目で持てない取引先(資産へ)・精算バッチ(食費へ)が外れる', () => {
    const [toAsset] = buildBulkUpdates([sel(e1, 11)], pickWith({ accountId: 3 }), accountById)
    expect(toAsset.input.lines[0]).toMatchObject({ accountId: 3, counterpartyId: null })
    const [toFood] = buildBulkUpdates([sel(e2, 21)], pickWith({ accountId: 1 }), accountById)
    expect(toFood.input.lines[0]).toMatchObject({ accountId: 1, settlementBatchId: null })
  })

  it('科目を既定メンバーのある科目に変えると、その行の世帯メンバーは既定メンバーになる', () => {
    const [update] = buildBulkUpdates([sel(e1, 11)], pickWith({ accountId: 5 }), accountById)
    expect(update.input.lines[0]).toMatchObject({ accountId: 5, householdMemberId: 2 })
  })

  it('貸借・金額・貸借の区分は変わらない', () => {
    const [update] = buildBulkUpdates([sel(e1, 11)], pickWith({ accountId: 3 }), accountById)
    expect(update.input.lines.map((l) => [l.side, l.amount])).toEqual([
      ['debit', 1000],
      ['credit', 1000],
    ])
  })
})

describe('summarizeBulkEdit(変更内容の表示)', () => {
  const labels = {
    project: (id: number) => `プロジェクト${id}`,
    counterparty: (id: number) => `取引先${id}`,
    batch: (id: number) => `バッチ${id}`,
    member: (id: number) => (id === 2 ? '妻' : '夫'),
  }

  it('何も選んでいないときは、変える項目を選ぶよう促す1行を返す', () => {
    const lines = summarizeBulkEdit([sel(e1, 11)], EMPTY_BULK_PICK, accountById, labels)
    expect(lines).toEqual([{ text: '変える項目を選ぶと、ここに変更の内容が出ます', warn: false }])
  })

  it('選んだ項目ごとに、変更後の値と適用される行数を出す', () => {
    const selected = [sel(e1, 11), sel(e1, 12)]
    const lines = summarizeBulkEdit(
      selected,
      pickWith({ project: { kind: 'set', value: 4 }, memberId: 2 }),
      accountById,
      labels,
    )
    expect(lines.map((l) => l.text)).toEqual(['プロジェクト → プロジェクト4: 2行に適用', '世帯メンバー → 妻: 2行に適用'])
  })

  it('「なし(外す)」は「なし」と出す', () => {
    const lines = summarizeBulkEdit([sel(e1, 11)], pickWith({ counterparty: { kind: 'clear' } }), accountById, labels)
    expect(lines[0].text).toBe('取引先 → なし: 1行に適用')
  })

  it('科目を変えるとき、取引先・精算バッチが外れる行があれば、その件数を警告として添える', () => {
    // e1 の11は取引先あり。資産(普通預金)に変えると外れる
    const toAsset = summarizeBulkEdit([sel(e1, 11), sel(e2, 22)], pickWith({ accountId: 3 }), accountById, labels)
    expect(toAsset[0].text).toBe('科目 → 普通預金: 2行に適用(取引先が付いている2行は、取引先が外れます)')
    expect(toAsset[0].warn).toBe(true)
    // e2 の21は精算バッチあり。食費に変えると外れる
    const toFood = summarizeBulkEdit([sel(e2, 21)], pickWith({ accountId: 1 }), accountById, labels)
    expect(toFood[0].text).toBe('科目 → 食費: 1行に適用(精算バッチが付いている1行は、精算バッチが外れます)')
  })

  it('外れるものがなければ、警告は付かない', () => {
    const lines = summarizeBulkEdit([sel(e1, 11)], pickWith({ accountId: 2 }), accountById, labels)
    expect(lines[0]).toEqual({ text: '科目 → 給与収入: 1行に適用', warn: false })
  })
})
