/**
 * 仕訳の絞り込みの「出どころ」(作成経路+取り込んだ金融機関、計画Issue #289)の、UI値とJournalEntryFilterの相互変換と、
 * 選択肢の組み立て(journalFilterModel)のユニットテスト。
 * 選択ツリーの値は、作成経路が「manual」などそのまま、金融機関が「inst:名前」、金融機関が不明な取込済みが「inst:」。
 * 選択肢は、取込済みの仕訳に金融機関が1つでもあれば「外部明細(すべて)」を親、各金融機関を子にして階層で並べる。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../../../domain/journal/JournalEntry'
import { collectFinancialInstitutionNames } from '../../../domain/statement-import/financialInstitution'
import {
  buildSourceFilterChoices,
  countActiveConditions,
  getSourceValues,
  setSourceValues,
} from './journalFilterModel'

function entry(sourceType: JournalEntry['sourceType'], financialInstitutionName?: string | null): Pick<JournalEntry, 'sourceType' | 'financialInstitutionName'> {
  return { sourceType, financialInstitutionName }
}

describe('getSourceValues / setSourceValues', () => {
  it('作成経路と金融機関名(不明はnull)を、選択ツリーの値の配列として取り出す', () => {
    const filter = { sourceTypes: ['manual' as const], financialInstitutionNames: ['三井住友銀行', null] }

    expect(getSourceValues(filter)).toEqual(['manual', 'inst:三井住友銀行', 'inst:'])
  })

  it('値の配列を、sourceTypesとfinancialInstitutionNamesに振り分ける', () => {
    expect(setSourceValues({}, ['manual', 'inst:楽天カード', 'inst:'])).toEqual({
      sourceTypes: ['manual'],
      financialInstitutionNames: ['楽天カード', null],
    })
  })

  it('片方だけの選択では、もう片方のキーを持たない', () => {
    expect(setSourceValues({}, ['inst:楽天カード'])).toEqual({ financialInstitutionNames: ['楽天カード'] })
    expect(setSourceValues({}, ['manual'])).toEqual({ sourceTypes: ['manual'] })
  })

  it('空配列で出どころの指定を両方とも消し、ほかの条件は保つ', () => {
    const filter = { memo: 'ガス', sourceTypes: ['manual' as const], financialInstitutionNames: ['楽天カード'] }

    expect(setSourceValues(filter, [])).toEqual({ memo: 'ガス' })
  })

  it('金融機関名だけの指定も、有効な条件1件として数える(作成経路と併用しても1件)', () => {
    expect(countActiveConditions({ financialInstitutionNames: ['楽天カード'] })).toBe(1)
    expect(countActiveConditions({ sourceTypes: ['manual'], financialInstitutionNames: [null] })).toBe(1)
  })
})

describe('buildSourceFilterChoices', () => {
  const nameOf = (choices: ReturnType<typeof buildSourceFilterChoices>, value: string) => choices.find((c) => c.value === value)?.name

  it('取込済みの仕訳に金融機関が無ければ、作成経路を従来どおり平らに並べ、外部明細は「外部明細」のままにする', () => {
    const choices = buildSourceFilterChoices([entry('manual'), entry('external_import', null), entry('external_import')])

    expect(nameOf(choices, 'external_import')).toBe('外部明細')
    expect(choices.some((c) => c.value.startsWith('inst:'))).toBe(false)
    expect(choices.every((c) => c.depth === undefined)).toBe(true)
    expect(choices.map((c) => c.value)).toContain('manual')
  })

  it('金融機関があれば、「外部明細(すべて)」の直下に、金融機関名を重複なく、マッピング定義の候補と同じ順で子として並べる', () => {
    const choices = buildSourceFilterChoices([
      entry('external_import', '楽天カード'),
      entry('external_import', '三井住友銀行'),
      entry('external_import', '楽天カード'),
    ])

    const parentIndex = choices.findIndex((c) => c.value === 'external_import')
    expect(choices[parentIndex]).toMatchObject({ name: '外部明細(すべて)', depth: 0 })
    // 並び順は、マッピング定義の選択候補と同じ(collectFinancialInstitutionNames。漢字は読み順にならない)
    const expectedNames = collectFinancialInstitutionNames(['楽天カード', '三井住友銀行'])
    expect(choices.slice(parentIndex + 1, parentIndex + 3)).toEqual(
      expectedNames.map((name) => ({ value: `inst:${name}`, name, depth: 1, parentValue: 'external_import' })),
    )
    expect(expectedNames).toHaveLength(2)
  })

  it('金融機関が不明な取込済みの仕訳もあるときだけ、「外部明細(金融機関が不明)」を最後の子として足す', () => {
    const withUnknown = buildSourceFilterChoices([entry('external_import', '楽天カード'), entry('external_import', null)])
    const withoutUnknown = buildSourceFilterChoices([entry('external_import', '楽天カード')])

    expect(withUnknown.find((c) => c.value === 'inst:')).toEqual({
      value: 'inst:',
      name: '外部明細(金融機関が不明)',
      depth: 1,
      parentValue: 'external_import',
    })
    expect(withoutUnknown.some((c) => c.value === 'inst:')).toBe(false)
  })

  it('取込でない仕訳が持つ金融機関名は、選択肢に出さない', () => {
    const choices = buildSourceFilterChoices([entry('manual', '三井住友銀行')])

    expect(choices.some((c) => c.value.startsWith('inst:'))).toBe(false)
  })

  it('そのほかの作成経路(手入力・割勘など)は、親の直後を飛ばさずに従来の並びで残る', () => {
    const choices = buildSourceFilterChoices([entry('external_import', '楽天カード')])

    expect(choices.map((c) => c.value).filter((v) => !v.startsWith('inst:'))).toEqual([
      'external_import',
      'manual',
      'expense_splitting',
      'recurring_generated',
      'initial_balance',
      'balance_adjustment',
      'auto_balance_adjustment',
    ])
  })
})
