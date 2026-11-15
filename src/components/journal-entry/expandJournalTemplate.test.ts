/**
 * expandJournalTemplate / describeTemplateExpansionWarnings の単体テスト(計画Issue #201)。
 * 「テンプレートから起票」で、テンプレートを「新規仕訳」フォームの初期値(日付・摘要・起票者・明細行)へ
 * 展開する純粋関数を検証する。日付は今日、金額の空欄は空文字、世帯メンバーは
 * 科目の既定メンバー > 行の指定 > 起票者 の順で決め、取引先はPL科目の行だけに残す。
 * 無効な科目・取引先・プロジェクト・世帯メンバー(一覧に無いものを含む)は、不正な値を
 * フォームに入れず空にして警告として返す(科目が空の行は、既存の入力チェックで確定できない)。DB・DOM非依存。
 */
import { describe, expect, it } from 'vitest'
import type { JournalTemplate, JournalTemplateLine } from '../../domain/journal-template/JournalTemplate'
import { describeTemplateExpansionWarnings, expandJournalTemplate } from './expandJournalTemplate'

const line = (overrides: Partial<JournalTemplateLine> & Pick<JournalTemplateLine, 'lineNo' | 'side' | 'accountId'>): JournalTemplateLine => ({
  amount: null,
  projectId: null,
  householdMemberId: null,
  counterpartyId: null,
  settlementBatchId: null,
  ...overrides,
})

const template = (overrides: Partial<JournalTemplate> = {}): JournalTemplate => ({
  id: 1,
  name: 'コンビニ(昼食)',
  memo: '昼食',
  bookkeeperHouseholdMemberId: null,
  groupId: null,
  sortOrder: 0,
  isActive: true,
  lines: [line({ lineNo: 1, side: 'debit', accountId: 1 }), line({ lineNo: 2, side: 'credit', accountId: 2 })],
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const master = {
  accounts: [
    { id: 1, name: '食費', category: 'expense' as const, isActive: true, householdMemberId: null },
    { id: 2, name: '現金', category: 'asset' as const, isActive: true, householdMemberId: null },
    { id: 3, name: '旧費用', category: 'expense' as const, isActive: false, householdMemberId: null },
    { id: 4, name: '配偶者の財布', category: 'asset' as const, isActive: true, householdMemberId: 20 },
  ],
  members: [
    { id: 10, name: '自分', isActive: true },
    { id: 20, name: '配偶者', isActive: true },
    { id: 30, name: '旧メンバー', isActive: false },
  ],
  projects: [
    { id: 1, name: '旅行', isActive: true },
    { id: 2, name: '旧旅行', isActive: false },
  ],
  counterparties: [
    { id: 1, name: 'ローソン', isActive: true },
    { id: 2, name: '閉店した店', isActive: false },
  ],
}

const expand = (t: JournalTemplate) => expandJournalTemplate({ template: t, today: '2026-11-15', ...master })

describe('expandJournalTemplate: 基本', () => {
  it('日付は今日、摘要はテンプレートの摘要、コメントは空にする', () => {
    const result = expand(template())

    expect(result).toMatchObject({ entryDate: '2026-11-15', memo: '昼食', comment: '' })
    expect(result.warnings).toEqual([])
  })

  it('摘要が無いテンプレートは摘要を空文字にする', () => {
    expect(expand(template({ memo: null })).memo).toBe('')
  })

  it('行の科目・貸借・金額(空欄は空文字)・プロジェクト・取引先・精算バッチを引き継ぐ', () => {
    const result = expand(
      template({
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 1, amount: 500, projectId: 1, counterpartyId: 1 }),
          line({ lineNo: 2, side: 'credit', accountId: 2, settlementBatchId: 7 }),
        ],
      }),
    )

    expect(result.lines).toMatchObject([
      { accountId: 1, side: 'debit', amountInput: '500', projectId: 1, counterpartyId: 1 },
      { accountId: 2, side: 'credit', amountInput: '', projectId: null, counterpartyId: null, settlementBatchId: 7 },
    ])
  })

  it('取引先はPL科目(収益・費用)の行だけに残し、それ以外の行では空にする(警告は出さない)', () => {
    const result = expand(
      template({
        lines: [line({ lineNo: 1, side: 'debit', accountId: 1 }), line({ lineNo: 2, side: 'credit', accountId: 2, counterpartyId: 1 })],
      }),
    )

    expect(result.lines[1].counterpartyId).toBeNull()
    expect(result.warnings).toEqual([])
  })
})

describe('expandJournalTemplate: 起票者と行の世帯メンバー', () => {
  it('起票者はテンプレートの指定、無ければ最初の有効なメンバー', () => {
    expect(expand(template({ bookkeeperHouseholdMemberId: 20 })).householdMemberId).toBe(20)
    expect(expand(template()).householdMemberId).toBe(10)
  })

  it('起票者が無効なメンバーのときは最初の有効なメンバーにして警告する', () => {
    const result = expand(template({ bookkeeperHouseholdMemberId: 30 }))

    expect(result.householdMemberId).toBe(10)
    expect(result.warnings).toEqual([{ lineNo: null, kind: 'bookkeeper', name: '旧メンバー' }])
  })

  it('行の世帯メンバーは、科目の既定 > 行の指定 > 起票者の順で決める', () => {
    const result = expand(
      template({
        bookkeeperHouseholdMemberId: 10,
        lines: [
          line({ lineNo: 1, side: 'debit', accountId: 1, householdMemberId: 20 }),
          line({ lineNo: 2, side: 'credit', accountId: 4, householdMemberId: 10 }),
          line({ lineNo: 3, side: 'credit', accountId: 2 }),
        ],
      }),
    )

    expect(result.lines.map((l) => l.householdMemberId)).toEqual([20, 20, 10])
  })

  it('行の世帯メンバーが無効なときは行では決めず、起票者にして警告する', () => {
    const result = expand(
      template({
        bookkeeperHouseholdMemberId: 10,
        lines: [line({ lineNo: 1, side: 'debit', accountId: 1, householdMemberId: 30 }), line({ lineNo: 2, side: 'credit', accountId: 2 })],
      }),
    )

    expect(result.lines[0].householdMemberId).toBe(10)
    expect(result.warnings).toEqual([{ lineNo: 1, kind: 'member', name: '旧メンバー' }])
  })
})

describe('expandJournalTemplate: 無効・存在しない項目', () => {
  it('無効な科目の行は科目を空にして警告する', () => {
    const result = expand(template({ lines: [line({ lineNo: 1, side: 'debit', accountId: 3 }), line({ lineNo: 2, side: 'credit', accountId: 2 })] }))

    expect(result.lines[0]).toMatchObject({ accountId: null, side: 'debit' })
    expect(result.warnings).toEqual([{ lineNo: 1, kind: 'account', name: '旧費用' }])
  })

  it('一覧に無い科目は「不明な科目」として警告する', () => {
    const result = expand(template({ lines: [line({ lineNo: 1, side: 'debit', accountId: 99 }), line({ lineNo: 2, side: 'credit', accountId: 2 })] }))

    expect(result.lines[0].accountId).toBeNull()
    expect(result.warnings).toEqual([{ lineNo: 1, kind: 'account', name: '不明な科目' }])
  })

  it('無効な取引先・プロジェクトは空にして警告する', () => {
    const result = expand(
      template({ lines: [line({ lineNo: 1, side: 'debit', accountId: 1, projectId: 2, counterpartyId: 2 }), line({ lineNo: 2, side: 'credit', accountId: 2 })] }),
    )

    expect(result.lines[0]).toMatchObject({ projectId: null, counterpartyId: null })
    expect(result.warnings).toEqual([
      { lineNo: 1, kind: 'project', name: '旧旅行' },
      { lineNo: 1, kind: 'counterparty', name: '閉店した店' },
    ])
  })
})

describe('describeTemplateExpansionWarnings', () => {
  it('警告を、行番号・種類・名前を含む日本語の文にする', () => {
    expect(
      describeTemplateExpansionWarnings([
        { lineNo: 1, kind: 'account', name: '旧費用' },
        { lineNo: 2, kind: 'counterparty', name: '閉店した店' },
        { lineNo: 2, kind: 'project', name: '旧旅行' },
        { lineNo: 3, kind: 'member', name: '旧メンバー' },
        { lineNo: null, kind: 'bookkeeper', name: '旧メンバー' },
      ]),
    ).toEqual([
      '1行目の科目「旧費用」は使えないため、選び直してください',
      '2行目の取引先「閉店した店」は無効のため、空にしました',
      '2行目のプロジェクト「旧旅行」は無効のため、空にしました',
      '3行目の世帯メンバー「旧メンバー」は無効のため、起票者にしました',
      '起票者「旧メンバー」は無効のため、別のメンバーにしました',
    ])
  })

  it('警告が無ければ空配列', () => {
    expect(describeTemplateExpansionWarnings([])).toEqual([])
  })
})
