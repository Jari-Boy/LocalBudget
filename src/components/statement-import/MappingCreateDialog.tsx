import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { inferMappingDefinitionDraft } from '../../domain/statement-import/inferMappingDefinitionDraft'
import { inferEncoding } from '../../domain/statement-import/inferEncoding'
import { previewMappingRows } from '../../domain/statement-import/previewMappingRows'
import { readCsv } from '../../domain/statement-import/readCsv'
import {
  mappingFormFromDraft,
  mappingFormToDefinition,
  validateMappingForm,
  type MappingForm,
} from '../master/mappingForm'
import { FinancialInstitutionSelect } from '../master/FinancialInstitutionSelect'

export interface MappingCreateDialogProps {
  /** 取込画面で選んだCSVの元のバイト列。文字コードを変えると、これを読み直してプレビューを更新する */
  bytes: Uint8Array
  /** 金融機関名の選択候補(既存の定義にある金融機関名) */
  institutionNames: readonly string[]
  /** 保存して、そのまま取り込みに進む。失敗したら例外を投げる(ダイアログは開いたまま) */
  onSave: (form: MappingForm) => Promise<void>
  onCancel: () => void
}

const DATE_FORMATS = ['YYYY/MM/DD', 'YYYY-MM-DD', 'YYYYMMDD', 'YYYY年MM月DD日']
/** 元のCSVとして見せる行数(大きなCSVでもダイアログを重くしない) */
const RAW_ROW_LIMIT = 200

function readRows(bytes: Uint8Array, encoding: string, delimiter: MappingForm['delimiter']): string[][] | null {
  try {
    return readCsv(bytes, { encoding, delimiter: delimiter === 'tab' ? '\t' : ',' })
  } catch {
    return null
  }
}

/**
 * 明細取込画面で、一致するマッピングが無いときにその場で定義を作るダイアログ(計画Issue #151)。
 * 選んだCSVから文字コード(inferEncoding)と列(inferMappingDefinitionDraft)を推測した下書きを出し、
 * 主要な項目(表示名・金融機関名・明細の種類・文字コード・日付の書式・金額と日付と摘要の列)だけを編集できる。
 * 区切り文字・見出しまでの行数・残高や外部IDの列などの細かい設定は、マスタの「明細マッピング」タブで変える。
 * プレビューは実際の取込と同じ変換(previewMappingRows)を使い、保存できない定義はその理由を示す。
 */
export function MappingCreateDialog({ bytes, institutionNames, onSave, onCancel }: MappingCreateDialogProps) {
  const { t } = useTranslation('statementImport')
  const { t: tMaster } = useTranslation('master')
  const [form, setForm] = useState<MappingForm>(() => {
    const encoding = inferEncoding(bytes)
    const rows = readRows(bytes, encoding, ',') ?? []
    return mappingFormFromDraft(inferMappingDefinitionDraft(rows), encoding)
  })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const set = <K extends keyof MappingForm>(key: K, value: MappingForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const rows = useMemo(() => readRows(bytes, form.encoding, form.delimiter), [bytes, form.encoding, form.delimiter])
  const preview = useMemo(
    () => (rows === null ? null : previewMappingRows(rows, mappingFormToDefinition(form))),
    [rows, form],
  )
  const formReasons = validateMappingForm(form)
  const split = form.amountMode === 'debit_credit_split'
  const headerCount = /^\d+$/.test(form.headerRows.trim()) ? Number(form.headerRows) : 0
  const columnCount = rows === null ? 0 : Math.max(0, ...rows.map((r) => r.length))
  const headerNames =
    rows !== null && headerCount > 0 && rows[headerCount - 1]
      ? rows[headerCount - 1]
      : Array.from({ length: columnCount }, (_, i) => tMaster('mappingTab.columnNumber', { n: i + 1 }))
  const options = headerNames.map((name, i) => ({ value: headerCount > 0 ? name : String(i), label: name }))

  // 見出しに出す、割り当て済みの列の役割(数字なら列番号、それ以外は見出し名、という既存の解釈と同じ)
  const columnRoles: Array<{ key: 'dateColumn' | 'descriptionColumn' | 'amountColumn' | 'debitColumn' | 'creditColumn'; role: string }> = [
    { key: 'dateColumn', role: tMaster('mappingTab.colDate') },
    { key: 'descriptionColumn', role: tMaster('mappingTab.colDescription') },
    ...(form.amountMode === 'debit_credit_split'
      ? [
          { key: 'debitColumn' as const, role: tMaster('mappingTab.debitColumn').replace('の列', '') },
          { key: 'creditColumn' as const, role: tMaster('mappingTab.creditColumn').replace('の列', '') },
        ]
      : [{ key: 'amountColumn' as const, role: tMaster('mappingTab.colAmount') }]),
  ]
  const columnIndexOf = (spec: string): number => {
    const value = spec.trim()
    if (value === '') return -1
    if (/^\d+$/.test(value)) return Number(value)
    return headerCount > 0 ? headerNames.indexOf(value) : -1
  }

  const errorCount = preview ? preview.rows.filter((r) => r.error !== null).length : 0
  // 一部の行(為替レートの補足行など)が読み取れなくても保存できる。ただし、列が見つからない、または
  // 1行も読み取れない定義は、取り込めないので保存できない(計画Issue #151)
  const readableCount = preview ? preview.rows.length - errorCount : 0
  const unusable =
    preview === null || preview.columnError !== null || (preview.rows.length > 0 && readableCount === 0)
  const reasons = formReasons
  // 取り込めない定義(列が見つからない、1行も読み取れない)のときだけ、その理由を示す
  const unusableMessage =
    preview === null
      ? tMaster('mappingTab.previewEmpty')
      : preview.columnError
        ? tMaster('mappingTab.columnNotFound', { field: preview.columnError.fieldName, spec: preview.columnError.columnSpec })
        : tMaster('mappingTab.statusErrors', { errors: errorCount, total: preview.rows.length })

  const submit = async () => {
    setSaving(true)
    setFailed(false)
    try {
      await onSave(form)
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  const field = (id: string, label: string, control: ReactNode) => (
    <div className="import-field import-dialog__cell">
      <label className="import-field__label" htmlFor={id}>
        {label}
      </label>
      {control}
    </div>
  )
  const columnSelect = (key: 'dateColumn' | 'descriptionColumn' | 'amountColumn' | 'debitColumn' | 'creditColumn', label: string) =>
    field(
      `dlg-${key}`,
      label,
      <select id={`dlg-${key}`} className="import-control" value={form[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">{tMaster('mappingTab.columnChoose')}</option>
        {form[key] !== '' && !options.some((o) => o.value === form[key]) && <option value={form[key]}>{form[key]}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>,
    )

  return (
    <div className="import-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label={t('mappingDialogTitle')} className="import-dialog import-dialog--xwide">
        <h2 className="import-dialog__title">{t('mappingDialogTitle')}</h2>
        <p role="status" className="import-summary">
          {t('mappingDialogGuessed')}
        </p>

        <div className="import-dialog__row">
          {field('dlg-label', tMaster('mappingTab.label'), <input id="dlg-label" className="import-control" value={form.label} onChange={(e) => set('label', e.target.value)} />)}
          {field('dlg-group', tMaster('mappingTab.formatGroup'), <FinancialInstitutionSelect id="dlg-group" className="import-control" value={form.formatGroupId} candidates={institutionNames} onChange={(name) => set('formatGroupId', name)} />)}
          {field(
            'dlg-kind',
            tMaster('mappingTab.kind'),
            <select id="dlg-kind" className="import-control" value={form.settled} onChange={(e) => set('settled', e.target.value as MappingForm['settled'])}>
              <option value="">{tMaster('mappingTab.settledNone')}</option>
              <option value="settled">{tMaster('mappingTab.settledTrue')}</option>
              <option value="provisional">{tMaster('mappingTab.settledFalse')}</option>
            </select>,
          )}
          {field(
            'dlg-encoding',
            tMaster('mappingTab.encoding'),
            <select id="dlg-encoding" className="import-control" value={form.encoding} onChange={(e) => set('encoding', e.target.value)}>
              <option value="utf-8">UTF-8</option>
              <option value="shift-jis">Shift-JIS</option>
            </select>,
          )}
          {field(
            'dlg-date-format',
            tMaster('mappingTab.dateFormat'),
            <select id="dlg-date-format" className="import-control" value={form.dateFormat} onChange={(e) => set('dateFormat', e.target.value)}>
              {DATE_FORMATS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>,
          )}
        </div>

        <div className="import-dialog__row">
          {columnSelect('dateColumn', tMaster('mappingTab.dateColumn'))}
          {columnSelect('descriptionColumn', tMaster('mappingTab.descriptionColumn'))}
          {field(
            'dlg-amount-mode',
            tMaster('mappingTab.amountMode'),
            <select
              id="dlg-amount-mode"
              className="import-control"
              value={form.amountMode}
              onChange={(e) => set('amountMode', e.target.value as MappingForm['amountMode'])}
            >
              <option value="single_signed">{tMaster('mappingTab.amountSingle')}</option>
              <option value="debit_credit_split">{tMaster('mappingTab.amountSplit')}</option>
            </select>,
          )}
          {split ? (
            <>
              {columnSelect('debitColumn', tMaster('mappingTab.debitColumn'))}
              {columnSelect('creditColumn', tMaster('mappingTab.creditColumn'))}
            </>
          ) : (
            <>
              {columnSelect('amountColumn', tMaster('mappingTab.amountColumn'))}
              {/* 反転は符号付き1列のときだけ。入金・出金の2列は列の割り当てを入れ替えれば足りる(計画Issue #192) */}
              <div className="import-field import-dialog__cell">
                <label>
                  <input
                    type="checkbox"
                    checked={form.invertAmountSign}
                    onChange={(e) => set('invertAmountSign', e.target.checked)}
                  />{' '}
                  {tMaster('mappingTab.invertAmountSign')}
                </label>
              </div>
            </>
          )}
        </div>

        {/* 取り込み前の生の状態。割り当てた列の見出しに役割を出し、列の割り当ての結果をここで確かめる */}
        <h3 className="import-dialog__subtitle">{tMaster('mappingTab.rawSection')}</h3>
        {rows !== null && (
          <div className="import-table-wrap import-dialog__raw">
            <table className="import-table" aria-label={tMaster('mappingTab.rawSection')}>
              <thead>
                <tr>
                  {headerNames.map((name, i) => {
                    const roles = columnRoles.filter((c) => columnIndexOf(form[c.key]) === i).map((c) => c.role)
                    return (
                      <th key={i} className={roles.length > 0 ? 'import-dialog__assigned' : undefined}>
                        {name}
                        <div className="import-dialog__role">{roles.join('・')}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.slice(headerCount, headerCount + RAW_ROW_LIMIT).map((row, r) => (
                  <tr key={r}>
                    {headerNames.map((_, i) => (
                      <td key={i} className="import-nowrap">
                        {row[i] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unusable && (
          <p role="status" className="import-error">
            {unusableMessage}
          </p>
        )}
        {errorCount > readableCount && !unusable && <p className="import-error">{tMaster('mappingTab.majorityWarning')}</p>}
        {errorCount > 0 && !unusable && <p className="import-note">{t('mappingDialogSkipNote')}</p>}
        <p className="import-note">{t('mappingDialogNote')}</p>

        {reasons.length > 0 && (
          <ul className="import-error">
            {reasons.map((reason) => (
              <li key={reason}>{tMaster(`mappingTab.reason${reason[0].toUpperCase()}${reason.slice(1)}`)}</li>
            ))}
          </ul>
        )}
        {failed && <p role="alert" className="import-error">{t('mappingDialogSaveError')}</p>}

        <div className="import-dialog__actions">
          <button type="button" className="import-btn" onClick={onCancel}>
            {t('cancelButton')}
          </button>
          <button
            type="button"
            className="import-btn import-btn--primary"
            disabled={saving || reasons.length > 0 || unusable}
            onClick={() => void submit()}
          >
            {t('mappingDialogSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
