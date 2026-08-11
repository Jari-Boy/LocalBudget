import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ExternalTransactionRef } from '../../domain/reconciliation/ExternalTransactionRef'
import { MappingColumnNotFoundError } from '../../domain/statement-import/MappingColumnNotFoundError'
import { readCsv } from '../../domain/statement-import/readCsv'
import {
  buildStatementImportReview,
  type StatementImportReviewResult,
} from '../../domain/statement-import/buildStatementImportReview'
import type { ApproximateDuplicateSearchOptions } from '../../domain/statement-import/duplicateDetection'
import { isStatementImportEligibleAccount } from './statementImportEligibility'
import './StatementImportUploadScreen.css'

/**
 * 確定版候補(近似重複)探索の既定閾値。金融機関によって速報/確定のズレ方
 * (数日〜数週間、手数料相当の差額等)が異なるため、ドメイン層では規定されていない
 * (docs/domain/statement-import.md 1.6)。日付は2週間、金額は1,000円までの差を許容する
 * 保守的な既定値とし、閾値そのものの調整UIは本Issueのスコープ外とする。
 */
const DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS: ApproximateDuplicateSearchOptions = {
  maxDateDiffDays: 14,
  maxAmountDiff: 1000,
}

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface MappingDefinitionFinder {
  findAvailableForAccount(accountId: number): ImportMappingDefinition[] | Promise<ImportMappingDefinition[]>
}
interface ExternalTransactionRefFinder {
  findByAccount(accountId: number): ExternalTransactionRef[] | Promise<ExternalTransactionRef[]>
}

export interface StatementImportUploadResult {
  targetAccount: Account
  definition: ImportMappingDefinition
  review: StatementImportReviewResult
}

export interface StatementImportUploadScreenProps {
  accountRepository: AccountFinder
  importMappingDefinitionRepository: MappingDefinitionFinder
  externalTransactionRefRepository: ExternalTransactionRefFinder
  onUploaded: (result: StatementImportUploadResult) => void
  onBack: () => void
  /** テスト用に近似重複判定の閾値を注入できるようにする。省略時はDEFAULT_APPROXIMATE_DUPLICATE_OPTIONS */
  approximateDuplicateOptions?: ApproximateDuplicateSearchOptions
}

/**
 * CSV取込アップロード画面(計画Issue #76、docs/domain/statement-import.md 1.5手順1)。
 * 対象科目→マッピング定義→CSVファイルの順に選び、「取り込む」操作でCSVパース
 * (readCsv→mapRowsToImportedRecordsを内包するbuildStatementImportReview)と
 * 重複防止フロー(1.6)の判定までをまとめて行う。CSVパース処理はメインスレッドで実行する
 * 方針(docs/architecture.md 12章)のため、Worker越しのRepository呼び出し(対象科目一覧・
 * マッピング定義候補・既存突合レコード)はここで完了させ、パース自体はブラウザのメイン
 * スレッド上で行う。成功したらonUploadedでレビュー一覧画面へ結果を渡す。
 */
export function StatementImportUploadScreen({
  accountRepository,
  importMappingDefinitionRepository,
  externalTransactionRefRepository,
  onUploaded,
  onBack,
  approximateDuplicateOptions,
}: StatementImportUploadScreenProps) {
  const { t } = useTranslation('statementImport')
  const { t: tCommon } = useTranslation('common')

  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [targetAccountId, setTargetAccountId] = useState<number | null>(null)
  const [definitions, setDefinitions] = useState<ImportMappingDefinition[]>([])
  const [definitionId, setDefinitionId] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve(accountRepository.findAll()).then(setAccounts)
  }, [accountRepository])

  useEffect(() => {
    if (targetAccountId === null) {
      setDefinitions([])
      setDefinitionId(null)
      return
    }
    void Promise.resolve(importMappingDefinitionRepository.findAvailableForAccount(targetAccountId)).then(
      (found) => {
        setDefinitions(found)
        setDefinitionId(found.length > 0 ? found[0].id : null)
      },
    )
  }, [targetAccountId, importMappingDefinitionRepository])

  if (accounts === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const eligibleAccounts = accounts.filter(isStatementImportEligibleAccount)
  const targetAccount = eligibleAccounts.find((account) => account.id === targetAccountId) ?? null
  const definition = definitions.find((candidate) => candidate.id === definitionId) ?? null

  async function handleUpload(): Promise<void> {
    if (targetAccount === null || definition === null || file === null) return

    setSubmitting(true)
    setError(null)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const rows = readCsv(bytes, { encoding: definition.encoding, delimiter: definition.delimiter })

      const existingRefs = await Promise.resolve(
        externalTransactionRefRepository.findByAccount(targetAccount.id),
      )
      const existingExternalIds = new Set(existingRefs.map((ref) => ref.externalId))
      const existingTransactions = existingRefs.map((ref) => ({
        journalEntryId: ref.journalEntryId,
        entryDate: ref.entryDate,
        amount: ref.amount,
        isSettled: ref.isSettled,
      }))

      const review = buildStatementImportReview({
        rows,
        definition,
        existingExternalIds,
        existingTransactions,
        approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
      })

      onUploaded({ targetAccount, definition, review })
    } catch (err) {
      setError(mapErrorToMessage(err))
      setSubmitting(false)
    }
  }

  function mapErrorToMessage(err: unknown): string {
    if (err instanceof MappingColumnNotFoundError) {
      return t('mappingMismatchError')
    }
    return t('uploadError')
  }

  return (
    <div className="statement-import-upload-screen">
      <h2>{t('uploadTitle')}</h2>

      <div>
        <label htmlFor="statement-import-account">{t('targetAccountLabel')}</label>
        <select
          id="statement-import-account"
          value={targetAccountId ?? ''}
          onChange={(event) => {
            setTargetAccountId(event.target.value === '' ? null : Number(event.target.value))
            setFile(null)
            setError(null)
          }}
        >
          <option value="">{t('unselected')}</option>
          {eligibleAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {targetAccountId !== null && (
        <div>
          <label htmlFor="statement-import-definition">{t('mappingDefinitionLabel')}</label>
          <select
            id="statement-import-definition"
            value={definitionId ?? ''}
            onChange={(event) =>
              setDefinitionId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            {definitions.length === 0 && <option value="">{t('noMappingDefinition')}</option>}
            {definitions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {definitionId !== null && (
        <div>
          <label htmlFor="statement-import-file">{t('csvFileLabel')}</label>
          <input
            id="statement-import-file"
            type="file"
            accept=".csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setError(null)
            }}
          />
        </div>
      )}

      {error && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
        <button
          type="button"
          disabled={submitting || targetAccount === null || definition === null || file === null}
          onClick={() => void handleUpload()}
        >
          {t('upload')}
        </button>
      </div>
    </div>
  )
}
