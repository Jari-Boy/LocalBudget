/**
 * mappingForm(マスタ画面「明細マッピング」タブの入力フォームのモデル、計画Issue #151)の
 * ユニットテスト。定義とフォームの相互変換(明細の種類・区切り文字の表記、金額の形式による
 * 列の出し分け)、CSVからの推測結果(ドラフト)の取り込み、保存できない理由の検証を確認する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import { inferMappingDefinitionDraft } from '../../domain/statement-import/inferMappingDefinitionDraft'
import {
  emptyMappingForm,
  mappingFormFromDefinition,
  mappingFormFromDraft,
  mappingFormToDefinition,
  mappingFormToInput,
  validateMappingForm,
  type MappingForm,
} from './mappingForm'

const DEFINITION: ImportMappingDefinition = {
  id: 7,
  accountIds: [3, 5],
  formatGroupId: '楽天カード',
  isSettled: false,
  label: '楽天カード(速報)',
  encoding: 'utf-8',
  delimiter: '\t',
  headerRowCount: 1,
  dateColumn: '利用日',
  dateFormat: 'YYYY/MM/DD',
  descriptionColumn: '利用店名',
  amountMode: 'single_signed',
  amountColumn: '利用金額',
  debitColumn: null,
  creditColumn: null,
  balanceColumn: null,
  externalIdColumn: null,
  createdAt: '',
  updatedAt: '',
}

function validForm(overrides: Partial<MappingForm> = {}): MappingForm {
  return { ...mappingFormFromDefinition(DEFINITION), ...overrides }
}

describe('mappingFormFromDefinition / mappingFormToInput', () => {
  it('明細の種類(確定・速報・区別なし)と区切り文字(タブ)をフォームの表記に変換する', () => {
    const form = mappingFormFromDefinition(DEFINITION)

    expect(form.settled).toBe('provisional')
    expect(form.delimiter).toBe('tab')
    expect(form.headerRows).toBe('1')
    expect(mappingFormFromDefinition({ ...DEFINITION, isSettled: true }).settled).toBe('settled')
    expect(mappingFormFromDefinition({ ...DEFINITION, isSettled: null }).settled).toBe('')
  })

  it('保存用の入力では金融機関名の表記ゆれ(全角半角・空白)がそろえられる(計画Issue #183)', () => {
    const input = mappingFormToInput({ ...mappingFormFromDefinition(DEFINITION), formatGroupId: ' ＰａｙＰａｙ カード ' })

    expect(input.formatGroupId).toBe('PayPayカード')
  })

  it('フォームから保存用の入力に戻すと、元の定義と同じ値になる', () => {
    const input = mappingFormToInput(mappingFormFromDefinition(DEFINITION))

    expect(input).toMatchObject({
      accountIds: [3, 5],
      formatGroupId: '楽天カード',
      isSettled: false,
      label: '楽天カード(速報)',
      delimiter: '\t',
      headerRowCount: 1,
      dateColumn: '利用日',
      amountMode: 'single_signed',
      amountColumn: '利用金額',
      debitColumn: null,
      creditColumn: null,
      balanceColumn: null,
      externalIdColumn: null,
    })
  })

  it('入金・出金の2列では金額列を、符号付き1列では入金・出金列を保存しない', () => {
    const split = mappingFormToInput(
      validForm({ amountMode: 'debit_credit_split', amountColumn: '残った値', debitColumn: '出金', creditColumn: '入金' }),
    )
    expect(split).toMatchObject({ amountColumn: null, debitColumn: '出金', creditColumn: '入金' })

    const single = mappingFormToInput(validForm({ debitColumn: '出金', creditColumn: '入金' }))
    expect(single).toMatchObject({ amountColumn: '利用金額', debitColumn: null, creditColumn: null })
  })

  it('任意の列が空文字なら未指定(null)で保存する', () => {
    const input = mappingFormToInput(validForm({ balanceColumn: '', externalIdColumn: '' }))

    expect(input.balanceColumn).toBeNull()
    expect(input.externalIdColumn).toBeNull()
  })
})

describe('mappingFormToDefinition', () => {
  it('未保存のフォームから、プレビューの変換に使う定義を作る', () => {
    const definition = mappingFormToDefinition(validForm({ headerRows: '2' }))

    expect(definition.headerRowCount).toBe(2)
    expect(definition.delimiter).toBe('\t')
    expect(definition.dateColumn).toBe('利用日')
  })
})

describe('validateMappingForm', () => {
  it('必須項目がそろっていれば理由は空', () => {
    expect(validateMappingForm(validForm())).toEqual([])
  })

  it('表示名・金融機関名・日付・摘要の列が空だと、それぞれ理由を返す', () => {
    const reasons = validateMappingForm(validForm({ label: ' ', formatGroupId: '', dateColumn: '', descriptionColumn: '' }))

    expect(reasons).toEqual(['labelRequired', 'formatGroupRequired', 'dateColumnRequired', 'descriptionColumnRequired'])
  })

  it('符号付き1列では金額の列、2列では入金と出金の両方の列が必須', () => {
    expect(validateMappingForm(validForm({ amountColumn: '' }))).toEqual(['amountColumnRequired'])
    expect(
      validateMappingForm(validForm({ amountMode: 'debit_credit_split', debitColumn: '出金', creditColumn: '' })),
    ).toEqual(['debitCreditColumnsRequired'])
  })

  it('見出しまでの行数は0以上の整数でなければならない', () => {
    expect(validateMappingForm(validForm({ headerRows: '-1' }))).toEqual(['headerRowsInvalid'])
    expect(validateMappingForm(validForm({ headerRows: 'a' }))).toEqual(['headerRowsInvalid'])
  })

  it('見出しの行がない(0行)と、列は番号でしか指定できない', () => {
    const reasons = validateMappingForm(validForm({ headerRows: '0' }))

    expect(reasons).toEqual(['columnNeedsHeader'])
    expect(
      validateMappingForm(
        validForm({ headerRows: '0', dateColumn: '0', descriptionColumn: '1', amountColumn: '2' }),
      ),
    ).toEqual([])
  })
})

describe('mappingFormFromDraft', () => {
  it('CSVの推測結果を取り込み、候補が1つに決まった列だけを割り当てる', () => {
    const rows = [
      ['利用日', '利用店名', '利用金額'],
      ['2026/10/01', 'A', '-100'],
      ['2026/10/02', 'B', '-200'],
    ]

    const form = mappingFormFromDraft(inferMappingDefinitionDraft(rows), 'shift-jis')

    expect(form.encoding).toBe('shift-jis')
    expect(form.headerRows).toBe('1')
    expect(form.dateColumn).toBe('利用日')
    expect(form.descriptionColumn).toBe('利用店名')
    expect(form.amountMode).toBe('single_signed')
    expect(form.amountColumn).toBe('利用金額')
    expect(form.label).toBe('')
  })

  it('見出しのないCSVでは列の番号を割り当てる', () => {
    const rows = [
      ['2026/10/01', 'A', '-100'],
      ['2026/10/02', 'B', '-200'],
    ]

    const form = mappingFormFromDraft(inferMappingDefinitionDraft(rows), 'utf-8')

    expect(form.headerRows).toBe('0')
    expect(form.dateColumn).toBe('0')
  })
})

describe('emptyMappingForm', () => {
  it('新規作成の初期値は、UTF-8・カンマ・見出し1行・符号付き1列', () => {
    const form = emptyMappingForm()

    expect(form).toMatchObject({ encoding: 'utf-8', delimiter: ',', headerRows: '1', amountMode: 'single_signed' })
    expect(form.accountIds).toEqual([])
  })
})
