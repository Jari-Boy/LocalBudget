/**
 * listTemplatePickerItems の単体テスト(計画Issue #201)。「テンプレートから起票」ダイアログに出す
 * 一覧を、マスタの並び順・グループの入れ子のまま平らな表示順に並べる(有効なテンプレートだけ、
 * 有効なテンプレートが無いグループは出さない)ことと、検索語があるときはグループ見出しを出さず
 * 該当するテンプレートだけを同じ順で返すこと(名称・摘要・科目名・取引先名の部分一致、複数語はAND、
 * 全角半角・大文字小文字を区別しない)を検証する。DB・DOM非依存。
 */
import { describe, expect, it } from 'vitest'
import type { JournalTemplate } from './JournalTemplate'
import type { JournalTemplateGroup } from '../journal-template-group/JournalTemplateGroup'
import { listTemplatePickerItems } from './listTemplatePickerItems'

const group = (id: number, name: string, parentGroupId: number | null, sortOrder: number, isActive = true): JournalTemplateGroup => ({
  id,
  name,
  parentGroupId,
  sortOrder,
  isActive,
  createdAt: '',
  updatedAt: '',
})

const template = (
  id: number,
  name: string,
  groupId: number | null,
  sortOrder: number,
  overrides: Partial<JournalTemplate> = {},
): JournalTemplate => ({
  id,
  name,
  memo: null,
  bookkeeperHouseholdMemberId: null,
  groupId,
  sortOrder,
  isActive: true,
  lines: [
    { lineNo: 1, side: 'debit', accountId: 1, amount: null, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    { lineNo: 2, side: 'credit', accountId: 2, amount: null, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
  ],
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const lookup = {
  accountNameById: new Map([
    [1, '食費'],
    [2, '現金'],
  ]),
  counterpartyNameById: new Map([[10, 'ローソン']]),
}

const labels = (items: ReturnType<typeof listTemplatePickerItems>) =>
  items.map((i) => (i.kind === 'group' ? `[${i.group.name}]` : i.template.name))

describe('listTemplatePickerItems: 検索語なし', () => {
  it('マスタの並び順とグループの入れ子のまま、見出しと直属のテンプレートを順に並べる', () => {
    const groups = [group(1, '食事', null, 0), group(2, '外食', 1, 1), group(3, '固定費', null, 2)]
    const templates = [
      template(1, 'コンビニ', 1, 0),
      template(2, 'スタバ', 2, 0),
      template(3, 'ジム', 3, 0),
      template(4, '病院', null, 3),
    ]

    const items = listTemplatePickerItems({ groups, templates, ...lookup, query: '' })

    expect(labels(items)).toEqual(['[食事]', 'コンビニ', '[外食]', 'スタバ', '[固定費]', 'ジム', '病院'])
    expect(items.map((i) => i.depth)).toEqual([0, 1, 1, 2, 0, 1, 0])
  })

  it('同じ入れ物の中ではsortOrderの昇順、同じ値ならグループが先でid順になる', () => {
    const groups = [group(1, 'G', null, 1)]
    const templates = [
      template(2, 'B', null, 1),
      template(1, 'A', null, 1),
      template(3, 'C', null, 0),
      template(4, 'D', 1, 0),
    ]

    const items = listTemplatePickerItems({ groups, templates, ...lookup, query: '' })

    expect(labels(items)).toEqual(['C', '[G]', 'D', 'A', 'B'])
  })

  it('無効なテンプレートは出さない', () => {
    const items = listTemplatePickerItems({
      groups: [],
      templates: [template(1, '有効', null, 0), template(2, '無効', null, 1, { isActive: false })],
      ...lookup,
      query: '',
    })

    expect(labels(items)).toEqual(['有効'])
  })

  it('有効なテンプレートが1つも無いグループ(入れ子を含む)は見出しも出さない', () => {
    const groups = [group(1, '親', null, 0), group(2, '子', 1, 0), group(3, '空', null, 1)]
    const templates = [template(1, '無効', 2, 0, { isActive: false })]

    expect(listTemplatePickerItems({ groups, templates, ...lookup, query: '' })).toEqual([])
  })

  it('無効なグループの中の有効なテンプレートも、見出し付きで出す', () => {
    const groups = [group(1, '旧', null, 0, false)]
    const templates = [template(1, 'A', 1, 0)]

    expect(labels(listTemplatePickerItems({ groups, templates, ...lookup, query: '' }))).toEqual(['[旧]', 'A'])
  })
})

describe('listTemplatePickerItems: 検索語あり', () => {
  const groups = [group(1, '食事', null, 0)]
  const templates = [
    template(1, 'コンビニ(昼食)', 1, 0, { memo: '昼ごはん' }),
    template(2, 'ジム', null, 1, {
      lines: [
        { lineNo: 1, side: 'debit', accountId: 1, amount: 8800, projectId: null, householdMemberId: null, counterpartyId: 10, settlementBatchId: null },
        { lineNo: 2, side: 'credit', accountId: 2, amount: 8800, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      ],
    }),
  ]

  it('グループ見出しを出さず、該当するテンプレートだけを元の順で返す', () => {
    const items = listTemplatePickerItems({ groups, templates, ...lookup, query: '食' })

    expect(labels(items)).toEqual(['コンビニ(昼食)', 'ジム'])
    expect(items.every((i) => i.kind === 'template' && i.depth === 0)).toBe(true)
  })

  it('名称・摘要・科目名・取引先名に部分一致する', () => {
    const pick = (query: string) => labels(listTemplatePickerItems({ groups, templates, ...lookup, query }))

    expect(pick('ジム')).toEqual(['ジム'])
    expect(pick('ごはん')).toEqual(['コンビニ(昼食)'])
    expect(pick('現金')).toEqual(['コンビニ(昼食)', 'ジム'])
    expect(pick('ローソン')).toEqual(['ジム'])
  })

  it('空白で区切った複数の語はすべて満たすものだけ(AND)', () => {
    expect(labels(listTemplatePickerItems({ groups, templates, ...lookup, query: '食費 ローソン' }))).toEqual(['ジム'])
    expect(labels(listTemplatePickerItems({ groups, templates, ...lookup, query: 'ジム 昼' }))).toEqual([])
  })

  it('全角半角・大文字小文字を区別しない', () => {
    const t = [template(1, 'Gym ＡＢＣ', null, 0)]

    expect(labels(listTemplatePickerItems({ groups: [], templates: t, ...lookup, query: 'gym abc' }))).toEqual(['Gym ＡＢＣ'])
  })

  it('空白だけの検索語は検索なしとして扱う', () => {
    expect(listTemplatePickerItems({ groups, templates, ...lookup, query: '  ' })).toEqual(
      listTemplatePickerItems({ groups, templates, ...lookup, query: '' }),
    )
  })

  it('無効なテンプレートは検索結果にも出さない', () => {
    const items = listTemplatePickerItems({
      groups: [],
      templates: [template(1, 'ジム', null, 0, { isActive: false })],
      ...lookup,
      query: 'ジム',
    })

    expect(items).toEqual([])
  })
})
