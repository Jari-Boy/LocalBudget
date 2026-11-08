import type {
  AmountMode,
  CreateImportMappingDefinitionInput,
  ImportMappingDefinition,
} from '../../domain/statement-import/ImportMappingDefinition'
import type { ColumnCandidate, ImportMappingDefinitionDraft } from '../../domain/statement-import/inferMappingDefinitionDraft'

/**
 * マスタ画面「明細マッピング」タブの入力フォームのモデル(計画Issue #151)。画面の入力は文字列で
 * 持ち(明細の種類は'settled'/'provisional'/''、区切り文字は'tab'/',')、保存時に定義の型へ変換する。
 * DB・DOM非依存の純粋関数。
 */
export interface MappingForm {
  label: string
  formatGroupId: string
  settled: '' | 'settled' | 'provisional'
  accountIds: number[]
  encoding: string
  delimiter: ',' | 'tab'
  headerRows: string
  dateFormat: string
  dateColumn: string
  descriptionColumn: string
  amountMode: AmountMode
  amountColumn: string
  debitColumn: string
  creditColumn: string
  balanceColumn: string
  externalIdColumn: string
}

/** 保存できない理由(翻訳キー)。 */
export type MappingFormReason =
  | 'labelRequired'
  | 'formatGroupRequired'
  | 'dateColumnRequired'
  | 'descriptionColumnRequired'
  | 'amountColumnRequired'
  | 'debitCreditColumnsRequired'
  | 'headerRowsInvalid'
  | 'columnNeedsHeader'

export function emptyMappingForm(): MappingForm {
  return {
    label: '',
    formatGroupId: '',
    settled: '',
    accountIds: [],
    encoding: 'utf-8',
    delimiter: ',',
    headerRows: '1',
    dateFormat: 'YYYY/MM/DD',
    dateColumn: '',
    descriptionColumn: '',
    amountMode: 'single_signed',
    amountColumn: '',
    debitColumn: '',
    creditColumn: '',
    balanceColumn: '',
    externalIdColumn: '',
  }
}

export function mappingFormFromDefinition(definition: ImportMappingDefinition): MappingForm {
  return {
    label: definition.label,
    formatGroupId: definition.formatGroupId,
    settled: definition.isSettled === null ? '' : definition.isSettled ? 'settled' : 'provisional',
    accountIds: [...definition.accountIds],
    encoding: definition.encoding,
    delimiter: definition.delimiter === '\t' ? 'tab' : ',',
    headerRows: String(definition.headerRowCount),
    dateFormat: definition.dateFormat,
    dateColumn: definition.dateColumn,
    descriptionColumn: definition.descriptionColumn,
    amountMode: definition.amountMode,
    amountColumn: definition.amountColumn ?? '',
    debitColumn: definition.debitColumn ?? '',
    creditColumn: definition.creditColumn ?? '',
    balanceColumn: definition.balanceColumn ?? '',
    externalIdColumn: definition.externalIdColumn ?? '',
  }
}

/** 候補がちょうど1つに決まった列だけを割り当てる。見出しがあれば見出し名、なければ列番号。 */
function pickColumn(candidates: readonly ColumnCandidate[]): string {
  if (candidates.length !== 1) return ''
  return candidates[0].headerName ?? String(candidates[0].columnIndex)
}

/** CSVからの推測結果(ドラフト)を新規作成フォームの初期値にする。 */
export function mappingFormFromDraft(draft: ImportMappingDefinitionDraft, encoding: string): MappingForm {
  return {
    ...emptyMappingForm(),
    encoding,
    headerRows: String(draft.headerRowCount),
    dateColumn: pickColumn(draft.dateColumn),
    descriptionColumn: pickColumn(draft.descriptionColumn),
    amountMode: draft.amountMode ?? 'single_signed',
    amountColumn: pickColumn(draft.amountColumn),
    debitColumn: pickColumn(draft.debitColumn),
    creditColumn: pickColumn(draft.creditColumn),
    balanceColumn: pickColumn(draft.balanceColumn),
  }
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())

export function mappingFormToInput(form: MappingForm): CreateImportMappingDefinitionInput {
  const split = form.amountMode === 'debit_credit_split'
  return {
    accountIds: form.accountIds,
    formatGroupId: form.formatGroupId.trim(),
    isSettled: form.settled === '' ? null : form.settled === 'settled',
    label: form.label.trim(),
    encoding: form.encoding,
    delimiter: form.delimiter === 'tab' ? '\t' : ',',
    headerRowCount: Number(form.headerRows),
    dateColumn: form.dateColumn.trim(),
    dateFormat: form.dateFormat,
    descriptionColumn: form.descriptionColumn.trim(),
    amountMode: form.amountMode,
    amountColumn: split ? null : orNull(form.amountColumn),
    debitColumn: split ? orNull(form.debitColumn) : null,
    creditColumn: split ? orNull(form.creditColumn) : null,
    balanceColumn: orNull(form.balanceColumn),
    externalIdColumn: orNull(form.externalIdColumn),
  }
}

/** 未保存のフォームから、プレビューの変換(取込と同じ処理)に渡す定義を作る。 */
export function mappingFormToDefinition(form: MappingForm): ImportMappingDefinition {
  const input = mappingFormToInput(form)
  return {
    id: 0,
    accountIds: form.accountIds,
    formatGroupId: input.formatGroupId,
    isSettled: input.isSettled ?? null,
    label: input.label,
    encoding: input.encoding!,
    delimiter: input.delimiter!,
    headerRowCount: input.headerRowCount!,
    dateColumn: input.dateColumn,
    dateFormat: input.dateFormat,
    descriptionColumn: input.descriptionColumn,
    amountMode: input.amountMode,
    amountColumn: input.amountColumn ?? null,
    debitColumn: input.debitColumn ?? null,
    creditColumn: input.creditColumn ?? null,
    balanceColumn: input.balanceColumn ?? null,
    externalIdColumn: input.externalIdColumn ?? null,
    createdAt: '',
    updatedAt: '',
  }
}

/** 保存できない理由の一覧。空なら保存できる。 */
export function validateMappingForm(form: MappingForm): MappingFormReason[] {
  const reasons: MappingFormReason[] = []
  if (form.label.trim() === '') reasons.push('labelRequired')
  if (form.formatGroupId.trim() === '') reasons.push('formatGroupRequired')
  if (form.dateColumn.trim() === '') reasons.push('dateColumnRequired')
  if (form.descriptionColumn.trim() === '') reasons.push('descriptionColumnRequired')
  if (form.amountMode === 'single_signed') {
    if (form.amountColumn.trim() === '') reasons.push('amountColumnRequired')
  } else if (form.debitColumn.trim() === '' || form.creditColumn.trim() === '') {
    reasons.push('debitCreditColumnsRequired')
  }

  if (!/^\d+$/.test(form.headerRows.trim())) {
    reasons.push('headerRowsInvalid')
  } else if (Number(form.headerRows) === 0) {
    const specs =
      form.amountMode === 'single_signed'
        ? [form.amountColumn]
        : [form.debitColumn, form.creditColumn]
    const all = [form.dateColumn, form.descriptionColumn, ...specs, form.balanceColumn, form.externalIdColumn]
    if (all.some((spec) => spec.trim() !== '' && !/^\d+$/.test(spec.trim()))) reasons.push('columnNeedsHeader')
  }
  return reasons
}
