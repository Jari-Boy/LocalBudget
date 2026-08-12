import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ExternalTransactionRef } from '../../domain/reconciliation/ExternalTransactionRef'
import {
  resolveMappingDefinitionCandidates,
  type MappingDefinitionCandidateMatch,
} from '../../domain/statement-import/resolveMappingDefinitionCandidates'
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
 * CSV取込アップロード画面(計画Issue #76の基盤を計画Issue #78でCSV先選択フローへ改修)。
 * 対象科目を選んだ後、マッピング定義ではなくCSVファイルを先に選択できる。「取り込む」操作で、
 * 対象科目で使える全マッピング定義候補それぞれに実際のパースを試み(resolveMappingDefinition
 * Candidates、readCsv→mapRowsToImportedRecordsをそれぞれ試行してエラーなく成功したものだけを
 * 残す絞り込み、docs/domain/statement-import.md 1.4・1.5手順1)、成功した候補が1件のみなら
 * そのまま重複防止フロー判定(buildStatementImportReview)まで行いonUploadedへ結果を渡す。
 * 成功した候補が複数ある場合はユーザーがlabelで選ぶまで待ち、0件の場合はエラー表示する。
 * CSVパース処理はメインスレッドで実行する方針(docs/architecture.md 12章)のため、Worker越しの
 * Repository呼び出し(対象科目一覧・マッピング定義候補・既存突合レコード)はここで完了させ、
 * パース自体はブラウザのメインスレッド上で行う。
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
  const [definitionsLoading, setDefinitionsLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidateMatches, setCandidateMatches] = useState<MappingDefinitionCandidateMatch[] | null>(
    null,
  )
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)

  useEffect(() => {
    void Promise.resolve(accountRepository.findAll()).then(setAccounts)
  }, [accountRepository])

  useEffect(() => {
    if (targetAccountId === null) {
      setDefinitions([])
      return
    }
    setDefinitionsLoading(true)
    void Promise.resolve(importMappingDefinitionRepository.findAvailableForAccount(targetAccountId)).then(
      (found) => {
        setDefinitions(found)
        setDefinitionsLoading(false)
      },
    )
  }, [targetAccountId, importMappingDefinitionRepository])

  if (accounts === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const eligibleAccounts = accounts.filter(isStatementImportEligibleAccount)
  const targetAccount = eligibleAccounts.find((account) => account.id === targetAccountId) ?? null

  function resetFileSelection() {
    setFile(null)
    setError(null)
    setCandidateMatches(null)
    setSelectedCandidateId(null)
  }

  async function handleUpload(): Promise<void> {
    if (targetAccount === null || file === null) return
    if (candidateMatches !== null && selectedCandidateId === null) return

    setSubmitting(true)
    setError(null)

    if (candidateMatches !== null) {
      const chosen = candidateMatches.find((match) => match.definition.id === selectedCandidateId)
      if (chosen === undefined) {
        setSubmitting(false)
        return
      }
      await finalizeUpload(targetAccount, chosen)
      return
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const matches = resolveMappingDefinitionCandidates(bytes, definitions)

      if (matches.length === 0) {
        setError(t('noMappingMatchError'))
        setSubmitting(false)
        return
      }

      if (matches.length === 1) {
        await finalizeUpload(targetAccount, matches[0])
        return
      }

      setCandidateMatches(matches)
      setSelectedCandidateId(null)
      setSubmitting(false)
    } catch {
      setError(t('uploadError'))
      setSubmitting(false)
    }
  }

  async function finalizeUpload(account: Account, match: MappingDefinitionCandidateMatch): Promise<void> {
    try {
      const existingRefs = await Promise.resolve(externalTransactionRefRepository.findByAccount(account.id))
      const existingExternalIds = new Set(existingRefs.map((ref) => ref.externalId))
      const existingTransactions = existingRefs.map((ref) => ({
        journalEntryId: ref.journalEntryId,
        entryDate: ref.entryDate,
        amount: ref.amount,
        isSettled: ref.isSettled,
      }))

      const review = buildStatementImportReview({
        rows: match.rows,
        definition: match.definition,
        existingExternalIds,
        existingTransactions,
        approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
      })

      onUploaded({ targetAccount: account, definition: match.definition, review })
    } catch {
      setError(t('uploadError'))
      setSubmitting(false)
    }
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
            resetFileSelection()
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

      {targetAccountId !== null && !definitionsLoading && (
        <div>
          <label htmlFor="statement-import-file">{t('csvFileLabel')}</label>
          <input
            id="statement-import-file"
            type="file"
            accept=".csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setError(null)
              setCandidateMatches(null)
              setSelectedCandidateId(null)
            }}
          />
        </div>
      )}

      {candidateMatches !== null && (
        <div>
          <label htmlFor="statement-import-definition">{t('mappingDefinitionLabel')}</label>
          <select
            id="statement-import-definition"
            value={selectedCandidateId ?? ''}
            onChange={(event) =>
              setSelectedCandidateId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('unselected')}</option>
            {candidateMatches.map((match) => (
              <option key={match.definition.id} value={match.definition.id}>
                {match.definition.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
        <button
          type="button"
          disabled={
            submitting ||
            targetAccount === null ||
            file === null ||
            (candidateMatches !== null && selectedCandidateId === null)
          }
          onClick={() => void handleUpload()}
        >
          {t('upload')}
        </button>
      </div>
    </div>
  )
}
