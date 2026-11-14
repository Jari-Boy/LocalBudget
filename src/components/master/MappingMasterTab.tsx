import { Fragment, useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { inferEncoding } from '../../domain/statement-import/inferEncoding'
import { inferMappingDefinitionDraft } from '../../domain/statement-import/inferMappingDefinitionDraft'
import { previewMappingRows, type MappingPreviewRow } from '../../domain/statement-import/previewMappingRows'
import { readCsv } from '../../domain/statement-import/readCsv'
import { previewJournalCells } from './previewJournalCells'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { isStatementImportEligibleAccount } from '../statement-import/statementImportEligibility'
import { FinancialInstitutionSelect } from './FinancialInstitutionSelect'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { buildAccountTree } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import {
  emptyMappingForm,
  mappingFormFromDefinition,
  mappingFormFromDraft,
  mappingFormToDefinition,
  mappingFormToInput,
  validateMappingForm,
  type MappingForm,
} from './mappingForm'
import './master.css'
import { collectFinancialInstitutionNames } from '../../domain/statement-import/financialInstitution'
import { groupMappingDefinitionsByInstitution } from '../../domain/statement-import/groupMappingDefinitionsByInstitution'

export interface MappingMasterTabProps {
  importMappingDefinitionRepository: MaybeAsync<
    Pick<ImportMappingDefinitionRepository, 'findAll' | 'create' | 'update' | 'delete'>
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
}

interface LoadedData {
  definitions: ImportMappingDefinition[]
  accounts: Account[]
  groups: AccountGroup[]
}

/** プレビュー用に選んだCSVの元のバイト列。文字コードを変えたときに読み直せるよう保持する(保存はしない) */
interface SampleCsv {
  bytes: Uint8Array
}

/** 編集パネルに渡す下書き。CSVからの新規作成では推測した値とCSVが付く */
interface Draft {
  form: MappingForm
  sample: SampleCsv | null
  notice: string
}

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

const DATE_FORMATS = ['YYYY/MM/DD', 'YYYY-MM-DD', 'YYYYMMDD', 'YYYY年MM月DD日']
const PREVIEW_RAW_ROW_LIMIT = 20

function tryReadCsv(sample: SampleCsv | null, form: MappingForm): string[][] | null {
  if (sample === null) return null
  try {
    return readCsv(sample.bytes, { encoding: form.encoding, delimiter: form.delimiter === 'tab' ? '\t' : ',' })
  } catch {
    return null
  }
}

/**
 * マスタ画面の「明細マッピング」タブ(計画Issue #151)。取込のCSVの形式を表すマッピング定義の
 * 一覧と編集を行う。選んだCSVの元データと取り込み結果を並べ、割り当てを変えるとその場で更新する。
 * プレビューは実際の取込と同じ変換(previewMappingRows)を使い、CSVは保存しない。
 */
export function MappingMasterTab({
  importMappingDefinitionRepository: repo,
  accountRepository,
  accountGroupRepository,
}: MappingMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [mode, setMode] = useState<number | 'create' | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftSeq, setDraftSeq] = useState(0)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  /** 未保存の編集があれば、行の選択・新規作成の前に確認を通す(計画Issue #190) */
  const guarded = useGuardedAction()

  const load = useCallback(async () => {
    const [definitions, accounts, groups] = await Promise.all([
      repo.findAll(),
      accountRepository.findAll(),
      accountGroupRepository.findAll(),
    ])
    setData({ definitions, accounts, groups })
  }, [repo, accountRepository, accountGroupRepository])

  useEffect(() => {
    void load()
  }, [load])

  const accountCategories = useMemo(() => {
    if (!data) return null
    const tree = buildAccountTree({
      groups: data.groups,
      accounts: data.accounts.filter(isStatementImportEligibleAccount),
      memberNameById: new Map(),
    })
    return buildTreeSelectCategories(tree, new Set()).filter((c) => c.nodes.length > 0)
  }, [data])

  if (data === null || accountCategories === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const accountNameById = new Map(data.accounts.map((a) => [a.id, a.name]))
  const institutionNames = collectFinancialInstitutionNames(data.definitions.map((d) => d.formatGroupId))
  const selected = typeof mode === 'number' ? data.definitions.find((d) => d.id === mode) : undefined
  const previewAccounts = data.accounts.filter(isStatementImportEligibleAccount)

  /** 操作を実行する。成功したらtrue、失敗してエラー文言を出したらfalse */
  const run = async (action: () => unknown, errorMessage: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await action()
      await load()
      return true
    } catch {
      setError(errorMessage)
      return false
    } finally {
      setBusy(false)
    }
  }

  const startFromCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const encoding = inferEncoding(bytes)
      const rows = readCsv(bytes, { encoding, delimiter: ',' })
      const started: Draft = {
        form: mappingFormFromDraft(inferMappingDefinitionDraft(rows), encoding),
        sample: { bytes },
        notice: t('mappingTab.guessed'),
      }
      // ファイルを選んだ後で、編集中の内容があれば確認を通してから新規作成の下書きに切り替える
      guarded(() => {
        setDraft(started)
        setDraftSeq((n) => n + 1)
        setMode('create')
        setArmed(false)
        setError('')
      })
    } catch {
      setError(t('mappingTab.readError'))
    }
  }

  const settledText = (d: ImportMappingDefinition) =>
    d.isSettled === null ? t('mappingTab.settledNone') : d.isSettled ? t('mappingTab.settledTrue') : t('mappingTab.settledFalse')

  const panelKey = mode === 'create' ? `create-${draftSeq}` : (selected?.id ?? 'none')

  return (
    <div className="master-split">
      <div className="master-split__main">
        <div className="master-actions">
          <label className="master-btn master-btn--primary">
            {t('mappingTab.add')}
            <input
              type="file"
              accept=".csv"
              aria-label={t('mappingTab.addCsvLabel')}
              hidden
              onChange={(event) => void startFromCsv(event)}
            />
          </label>
        </div>
        <ul className="master-list">
          {groupMappingDefinitionsByInstitution(data.definitions).map((group) => (
            <li key={group.name} role="group" aria-labelledby={`map-group-${group.name}`} className="master-list__group">
              <h3 id={`map-group-${group.name}`} className="master-list__group-title">
                {group.name}
              </h3>
              <ul className="master-list">
                {group.definitions.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={`master-list__button master-list__button--grouped${d.id === mode ? ' master-list__button--selected' : ''}`}
                      aria-current={d.id === mode ? 'true' : undefined}
                      onClick={() =>
                        guarded(() => {
                          setMode(d.id)
                          setArmed(false)
                          setError('')
                          setFlash('')
                        })
                      }
                    >
                      <span>{d.label}</span>
                      <span className="master-note">
                        {d.accountIds.length > 0
                          ? d.accountIds.map((id) => accountNameById.get(id) ?? '').join('、')
                          : t('mappingTab.noAccounts')}
                        {' ・ '}
                        {settledText(d)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p role="alert" className="master-error master-split__alert">
          {error}
        </p>
      )}

      {mode !== null && (mode === 'create' || selected) && (
        <MappingPanel
          key={panelKey}
          initial={
            mode === 'create' ? (draft ?? { form: emptyMappingForm(), sample: null, notice: '' }) : { form: mappingFormFromDefinition(selected!), sample: null, notice: '' }
          }
          isCreate={mode === 'create'}
          accountCategories={accountCategories}
          accountNameById={accountNameById}
          previewAccounts={previewAccounts}
          institutionNames={institutionNames}
          busy={busy}
          armed={armed}
          flash={flash}
          onSave={(form) =>
            run(async () => {
              if (selected) {
                await repo.update(selected.id, mappingFormToInput(form))
              } else {
                const created = await repo.create(mappingFormToInput(form))
                setMode(created.id)
              }
              setFlash(t('accountTab.saved'))
            }, t('accountTab.saveError'))
          }
          onDuplicate={(form) =>
            run(async () => {
              const created = await repo.create({
                ...mappingFormToInput(form),
                label: t('mappingTab.copySuffix', { label: form.label }),
              })
              setMode(created.id)
              setArmed(false)
            }, t('accountTab.createError'))
          }
          onDelete={() => {
            if (!selected) return
            if (!armed) {
              setArmed(true)
              return
            }
            void run(async () => {
              await repo.delete(selected.id)
              setMode(null)
              setArmed(false)
            }, t('accountTab.deleteError'))
          }}
        />
      )}
    </div>
  )
}

interface MappingPanelProps {
  initial: Draft
  isCreate: boolean
  accountCategories: ReturnType<typeof buildTreeSelectCategories>
  accountNameById: ReadonlyMap<number, string>
  /** プレビュー(仕訳形式)に使う科目の選択肢(明細の取込先にできる科目) */
  previewAccounts: readonly Account[]
  /** 金融機関名の選択候補(既存の定義にある金融機関名) */
  institutionNames: readonly string[]
  busy: boolean
  armed: boolean
  flash: string
  onSave: (form: MappingForm) => Promise<boolean>
  onDuplicate: (form: MappingForm) => unknown
  onDelete: () => void
}

/** マッピングの編集フォームと、元のCSV・取り込み結果のプレビュー(右パネル) */
function MappingPanel(props: MappingPanelProps) {
  const { t } = useTranslation('master')
  const [form, setForm] = useState<MappingForm>(props.initial.form)
  const [sample, setSample] = useState<SampleCsv | null>(props.initial.sample)
  const [notice, setNotice] = useState(props.initial.notice)
  const set = <K extends keyof MappingForm>(key: K, value: MappingForm[K]) => {
    setNotice('')
    setForm((f) => ({ ...f, [key]: value }))
  }

  /** プレビューする科目。選ぶまでは、紐づけ済みの先頭の科目。null は未選択(借方・貸方を出さない)(計画Issue #192) */
  const [previewAccountChoice, setPreviewAccountChoice] = useState<number | null | undefined>(undefined)
  const previewAccountId = previewAccountChoice === undefined ? (form.accountIds[0] ?? null) : previewAccountChoice
  const previewAccount = props.previewAccounts.find((a) => a.id === previewAccountId) ?? null

  const rows = useMemo(() => tryReadCsv(sample, form), [sample, form.encoding, form.delimiter]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(
    () => (rows === null ? null : previewMappingRows(rows, mappingFormToDefinition(form))),
    [rows, form],
  )
  const reasons = validateMappingForm(form)
  // 入力が保存済みの値(新規作成は空の状態)と違う間は、画面を離れる前に確認する(計画Issue #190)。
  // 検証エラーが残っていて保存できないときは、「保存して移動」でも移動しない
  const baseline = props.isCreate ? emptyMappingForm() : props.initial.form
  const unsavedDialog = useUnsavedEditGuard({
    dirty: JSON.stringify(form) !== JSON.stringify(baseline),
    save: () => (reasons.length > 0 ? Promise.resolve(false) : props.onSave(form)),
  })
  const split = form.amountMode === 'debit_credit_split'
  const headerCount = /^\d+$/.test(form.headerRows.trim()) ? Number(form.headerRows) : 0

  const columnCount = rows === null ? 0 : Math.max(0, ...rows.map((r) => r.length))
  const headerNames =
    rows !== null && headerCount > 0 && rows[headerCount - 1]
      ? rows[headerCount - 1]
      : Array.from({ length: columnCount }, (_, i) => t('mappingTab.columnNumber', { n: i + 1 }))
  const columnOptions = headerNames.map((name, i) => ({ value: headerCount > 0 ? name : String(i), label: name }))

  const columnDefs: Array<{ key: keyof MappingForm; label: string; role: string; optional: boolean }> = [
    { key: 'dateColumn', label: t('mappingTab.dateColumn'), role: t('mappingTab.colDate'), optional: false },
    { key: 'descriptionColumn', label: t('mappingTab.descriptionColumn'), role: t('mappingTab.colDescription'), optional: false },
    ...(split
      ? [
          { key: 'debitColumn' as const, label: t('mappingTab.debitColumn'), role: t('mappingTab.debitColumn').replace('の列', ''), optional: false },
          { key: 'creditColumn' as const, label: t('mappingTab.creditColumn'), role: t('mappingTab.creditColumn').replace('の列', ''), optional: false },
        ]
      : [{ key: 'amountColumn' as const, label: t('mappingTab.amountColumn'), role: t('mappingTab.colAmount'), optional: false }]),
    { key: 'balanceColumn', label: t('mappingTab.balanceColumn'), role: t('mappingTab.colBalance'), optional: true },
    { key: 'externalIdColumn', label: t('mappingTab.externalIdColumn'), role: t('mappingTab.colExternalId'), optional: true },
  ]

  const columnIndexOf = (spec: string): number => {
    const value = spec.trim()
    if (value === '') return -1
    if (/^\d+$/.test(value)) return Number(value)
    return headerCount > 0 ? headerNames.indexOf(value) : -1
  }

  const onSampleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSample({ bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  const signedYen = (n: number) => `${n < 0 ? '-' : '+'}${yen(Math.abs(n))}`
  /** 読み取れない行・摘要が無い行の理由。問題が無ければnull(表には何も出さない) */
  const errorText = (row: MappingPreviewRow): string | null => {
    if (row.error === 'invalidDate') return t('mappingTab.errorInvalidDate')
    if (row.error === 'invalidAmount') return t('mappingTab.errorInvalidAmount')
    if (row.error === 'unknown') return t('mappingTab.errorUnknown')
    return row.record && row.record.description === '' ? t('mappingTab.errorNoDescription') : null
  }
  const errorCount = preview ? preview.rows.filter((r) => r.error !== null).length : 0

  const statusText = (() => {
    if (preview === null) return t('mappingTab.previewEmpty')
    if (preview.columnError) {
      return t('mappingTab.columnNotFound', {
        field: columnDefs.find((c) => c.key === preview.columnError!.fieldName)?.label ?? preview.columnError.fieldName,
        spec: preview.columnError.columnSpec,
      })
    }
    return errorCount > 0
      ? t('mappingTab.statusErrors', { errors: errorCount, total: preview.rows.length })
      : t('mappingTab.statusOk', { total: preview.rows.length })
  })()
  const statusIsError = preview !== null && (preview.columnError !== null || errorCount > 0)

  const addAccount = (value: string) => {
    const id = Number(value)
    if (!Number.isFinite(id) || value === '' || form.accountIds.includes(id)) return
    set('accountIds', [...form.accountIds, id])
  }

  return (
    <section className="master-panel" aria-label={t('mappingTab.editTitle')}>
      <h2 className="master-panel__title">{t('mappingTab.editTitle')}</h2>
      {notice && (
        <p role="status" className="master-flash">
          {notice}
        </p>
      )}

      <div className="master-field">
        <label className="master-field__label" htmlFor="map-label">
          {t('mappingTab.label')}
        </label>
        <input id="map-label" className="master-field__control" value={form.label} onChange={(e) => set('label', e.target.value)} />
      </div>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-group">
          {t('mappingTab.formatGroup')}
        </label>
        <FinancialInstitutionSelect
          id="map-group"
          className="master-field__control"
          value={form.formatGroupId}
          candidates={props.institutionNames}
          onChange={(name) => set('formatGroupId', name)}
        />
      </div>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-settled">
          {t('mappingTab.kind')}
        </label>
        <select
          id="map-settled"
          className="master-field__control"
          value={form.settled}
          onChange={(e) => set('settled', e.target.value as MappingForm['settled'])}
        >
          <option value="">{t('mappingTab.settledNone')}</option>
          <option value="settled">{t('mappingTab.settledTrue')}</option>
          <option value="provisional">{t('mappingTab.settledFalse')}</option>
        </select>
      </div>

      <div className="master-field">
        <span className="master-field__label">{t('mappingTab.accounts')}</span>
        <TreeSelect
          label={t('mappingTab.accounts')}
          categories={props.accountCategories}
          value=""
          onChange={addAccount}
          placeholder={t('mappingTab.addAccount')}
        />
        <div className="master-actions">
          {form.accountIds.map((id) => {
            const name = props.accountNameById.get(id) ?? ''
            return (
              <span key={id} className="master-chip">
                {name}
                <button
                  type="button"
                  className="master-chip__remove"
                  aria-label={t('mappingTab.removeAccount', { name })}
                  onClick={() => set('accountIds', form.accountIds.filter((a) => a !== id))}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
        <p className="master-note">
          {form.accountIds.length > 0 ? t('mappingTab.accountsNoteSome') : t('mappingTab.accountsNoteNone')}
        </p>
      </div>

      <h3 className="master-subsection__title">{t('mappingTab.readSection')}</h3>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-encoding">
          {t('mappingTab.encoding')}
        </label>
        <select id="map-encoding" className="master-field__control" value={form.encoding} onChange={(e) => set('encoding', e.target.value)}>
          <option value="utf-8">UTF-8</option>
          <option value="shift-jis">Shift-JIS</option>
        </select>
      </div>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-delimiter">
          {t('mappingTab.delimiter')}
        </label>
        <select
          id="map-delimiter"
          className="master-field__control"
          value={form.delimiter}
          onChange={(e) => set('delimiter', e.target.value as MappingForm['delimiter'])}
        >
          <option value=",">{t('mappingTab.delimiterComma')}</option>
          <option value="tab">{t('mappingTab.delimiterTab')}</option>
        </select>
      </div>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-header">
          {t('mappingTab.headerRows')}
        </label>
        <input
          id="map-header"
          className="master-field__control"
          inputMode="numeric"
          value={form.headerRows}
          onChange={(e) => set('headerRows', e.target.value)}
        />
      </div>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-date-format">
          {t('mappingTab.dateFormat')}
        </label>
        <select id="map-date-format" className="master-field__control" value={form.dateFormat} onChange={(e) => set('dateFormat', e.target.value)}>
          {DATE_FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>

      <h3 className="master-subsection__title">{t('mappingTab.columnSection')}</h3>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-amount-mode">
          {t('mappingTab.amountMode')}
        </label>
        <select
          id="map-amount-mode"
          className="master-field__control"
          value={form.amountMode}
          onChange={(e) => set('amountMode', e.target.value as MappingForm['amountMode'])}
        >
          <option value="single_signed">{t('mappingTab.amountSingle')}</option>
          <option value="debit_credit_split">{t('mappingTab.amountSplit')}</option>
        </select>
      </div>
      {columnDefs.map((c) => {
        const value = form[c.key] as string
        const id = `map-col-${c.key}`
        return (
          <Fragment key={c.key}>
            <div className="master-field">
              <label className="master-field__label" htmlFor={id}>
                {c.label}
              </label>
              {rows !== null ? (
                <select id={id} className="master-field__control" value={value} onChange={(e) => set(c.key, e.target.value as never)}>
                  <option value="">{c.optional ? t('mappingTab.columnNone') : t('mappingTab.columnChoose')}</option>
                  {value !== '' && !columnOptions.some((o) => o.value === value) && <option value={value}>{value}</option>}
                  {columnOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={id} className="master-field__control" value={value} onChange={(e) => set(c.key, e.target.value as never)} />
              )}
            </div>
            {/* 反転は符号付き1列のときだけ。入金・出金の2列は列の割り当てを入れ替えれば足りる(計画Issue #192) */}
            {c.key === 'amountColumn' && (
              <div className="master-field">
                <label className="master-check">
                  <input
                    type="checkbox"
                    checked={form.invertAmountSign}
                    onChange={(e) => set('invertAmountSign', e.target.checked)}
                  />
                  {t('mappingTab.invertAmountSign')}
                </label>
              </div>
            )}
          </Fragment>
        )
      })}

      <h3 className="master-subsection__title">{t('mappingTab.rawSection')}</h3>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-sample">
          {t('mappingTab.previewCsvLabel')}
        </label>
        <input id="map-sample" type="file" accept=".csv" onChange={(e) => void onSampleFile(e)} />
        <p className="master-note">{t('mappingTab.previewCsvNote')}</p>
      </div>
      {rows !== null && (
        <div className="master-table-wrap">
          <table className="master-table">
            <thead>
              <tr>
                {headerNames.map((name, i) => (
                  <th key={i}>
                    {name}
                    <div>
                      {columnDefs
                        .filter((c) => columnIndexOf(form[c.key] as string) === i)
                        .map((c) => c.role)
                        .join('・')}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(headerCount, headerCount + PREVIEW_RAW_ROW_LIMIT).map((row, r) => (
                <tr key={r}>
                  {headerNames.map((_, i) => (
                    <td key={i}>{row[i] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="master-subsection__title">{t('mappingTab.previewSection')}</h3>
      <div className="master-field">
        <label className="master-field__label" htmlFor="map-preview-account">
          {t('mappingTab.previewAccount')}
        </label>
        <select
          id="map-preview-account"
          className="master-field__control"
          value={previewAccount?.id ?? ''}
          onChange={(e) => setPreviewAccountChoice(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">{t('mappingTab.previewAccountNone')}</option>
          {props.previewAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <p role="status" className={statusIsError ? 'master-error' : 'master-note'}>
        {statusText}
      </p>
      {preview !== null && !preview.columnError && errorCount > preview.rows.length - errorCount && (
        <p className="master-error">{t('mappingTab.majorityWarning')}</p>
      )}
      {errorCount > 0 && preview !== null && !preview.columnError && (
        <p className="master-note">{t('mappingTab.skipNote')}</p>
      )}
      {preview !== null && !preview.columnError && (
        <div className="master-table-wrap">
          <table className="master-table" aria-label={t('mappingTab.previewSection')}>
            <thead>
              <tr>
                <th>{t('mappingTab.colDate')}</th>
                <th>{t('mappingTab.colDescription')}</th>
                {previewAccount ? (
                  <>
                    <th>{t('mappingTab.colDebit')}</th>
                    <th>{t('mappingTab.colCredit')}</th>
                  </>
                ) : (
                  <th>{t('mappingTab.colAmount')}</th>
                )}
                <th>{t('mappingTab.colBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.record?.entryDate ?? '-'}</td>
                  <td>
                    {errorText(row) ? (
                      <span className="master-error">{errorText(row)}</span>
                    ) : (
                      row.record?.description || '-'
                    )}
                  </td>
                  {previewAccount ? (
                    (() => {
                      const cells = row.record
                        ? previewJournalCells(row.record.amount, previewAccount, t('mappingTab.anyAccount'))
                        : null
                      return (
                        <>
                          <td>{cells?.debit ?? '-'}</td>
                          <td>{cells?.credit ?? '-'}</td>
                        </>
                      )
                    })()
                  ) : (
                    <td>{row.record ? signedYen(row.record.amount) : '-'}</td>
                  )}
                  <td>{row.record?.balanceAfter != null ? yen(row.record.balanceAfter) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="master-note">{t('mappingTab.amountNote')}</p>

      {reasons.length > 0 && (
        <ul className="master-error">
          {reasons.map((reason) => (
            <li key={reason}>{t(`mappingTab.reason${reason[0].toUpperCase()}${reason.slice(1)}`)}</li>
          ))}
        </ul>
      )}

      <div className="master-actions">
        <button
          type="button"
          className="master-btn master-btn--primary"
          disabled={props.busy || reasons.length > 0}
          onClick={() => void props.onSave(form)}
        >
          {t('accountTab.save')}
        </button>
        {!props.isCreate && (
          <>
            <button type="button" className="master-btn" disabled={props.busy || reasons.length > 0} onClick={() => void props.onDuplicate(form)}>
              {t('mappingTab.duplicate')}
            </button>
            <button type="button" className="master-btn master-btn--danger" disabled={props.busy} onClick={props.onDelete}>
              {props.armed ? t('accountTab.deleteConfirm') : t('accountTab.delete')}
            </button>
          </>
        )}
        {props.flash && (
          <span role="status" className="master-flash">
            {props.flash}
          </span>
        )}
      </div>
      {unsavedDialog}
    </section>
  )
}
