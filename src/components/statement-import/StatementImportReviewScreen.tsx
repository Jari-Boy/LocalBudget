import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import { checkBalanceReconciliation } from '../../domain/reconciliation/checkBalanceReconciliation'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { isManualEntryEligibleAccount } from '../journal-entry/journalEntryFormLine'
import './StatementImportReviewScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}

export interface StatementImportReviewScreenProps {
  targetAccount: Account
  review: StatementImportReviewResult
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
}

type ApproximateDecision = 'unresolved' | 'confirmed_replacement' | 'different_transaction'

interface RecordReviewState {
  counterAccountId: number | null
  includeDuplicate: boolean
  approximateDecision: ApproximateDecision
}

function createInitialRecordState(): RecordReviewState {
  return { counterAccountId: null, includeDuplicate: false, approximateDecision: 'unresolved' }
}

/**
 * CSV取込レビュー一覧画面(計画Issue #76、docs/domain/statement-import.md 1.5手順2〜4)。
 * アップロード済みのレコード一覧を表示し、相手勘定科目の手動選択(取引先推定サジェストは
 * 後続の計画Issue #77のスコープ)、重複防止フロー(1.6)の警告表示・ユーザー選択、
 * 残高照合(docs/domain/reconciliation.md 1.5)の警告表示を行う。本Issueのスコープでは
 * レビュー確定操作(永続化)自体は行わない。編集内容はReact stateのみで保持し、
 * ドラフト自動保存機構(journal_entry_drafts)は流用しない(計画Issue #76制約・前提)。
 */
export function StatementImportReviewScreen({
  targetAccount,
  review,
  accountRepository,
  journalEntryRepository,
  onBack,
}: StatementImportReviewScreenProps) {
  const { t } = useTranslation('statementImport')
  const { t: tCommon } = useTranslation('common')

  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [bookBalance, setBookBalance] = useState<number | null>(null)
  const [recordStates, setRecordStates] = useState<RecordReviewState[]>(() =>
    review.records.map(() => createInitialRecordState()),
  )

  useEffect(() => {
    void Promise.resolve(accountRepository.findAll()).then(setAccounts)
  }, [accountRepository])

  useEffect(() => {
    if (targetAccount.isReconcilable !== true || review.latestExternalBalance === null) {
      setBookBalance(null)
      return
    }
    void Promise.resolve(journalEntryRepository.findAll()).then((entries) => {
      const accountLines = entries
        .flatMap((entry) => entry.lines)
        .filter((line) => line.accountId === targetAccount.id)
      setBookBalance(checkBalanceReconciliation(accountLines, review.latestExternalBalance!).bookBalance)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAccount.id, targetAccount.isReconcilable, review.latestExternalBalance, journalEntryRepository])

  function updateRecordState(index: number, updater: (state: RecordReviewState) => RecordReviewState) {
    setRecordStates((prev) => prev.map((state, i) => (i === index ? updater(state) : state)))
  }

  if (accounts === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const counterAccountCandidates = accounts.filter(isManualEntryEligibleAccount)
  const showReconciliation = targetAccount.isReconcilable === true && review.latestExternalBalance !== null
  const externalBalance = review.latestExternalBalance
  const isReconciled = bookBalance !== null && externalBalance !== null ? bookBalance === externalBalance : null

  return (
    <div className="statement-import-review-screen">
      <h2>{t('reviewTitle')}</h2>

      {showReconciliation && bookBalance !== null && externalBalance !== null && (
        <p role={isReconciled ? 'status' : 'alert'}>
          {isReconciled
            ? t('balanceReconciled')
            : t('balanceMismatchWarning', {
                bookBalance: formatCurrency(bookBalance, 'JPY'),
                externalBalance: formatCurrency(externalBalance, 'JPY'),
                difference: formatCurrency(externalBalance - bookBalance, 'JPY'),
              })}
        </p>
      )}

      {review.records.length === 0 ? (
        <p>{t('reviewEmpty')}</p>
      ) : (
        review.records.map((reviewRecord, index) => {
          const state = recordStates[index]
          const idPrefix = `statement-import-record-${index}`

          return (
            <fieldset key={reviewRecord.externalId}>
              <legend>{t('recordGroupLabel', { index: index + 1 })}</legend>

              <p>{reviewRecord.record.entryDate}</p>
              <p>{reviewRecord.record.description}</p>
              <p>{formatCurrency(reviewRecord.record.amount, 'JPY')}</p>

              <label htmlFor={`${idPrefix}-counter-account`}>{t('counterAccountLabel')}</label>
              <select
                id={`${idPrefix}-counter-account`}
                value={state.counterAccountId ?? ''}
                onChange={(event) =>
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    counterAccountId: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              >
                <option value="">{t('unselected')}</option>
                {counterAccountCandidates.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>

              {reviewRecord.isExactDuplicate && (
                <div role="alert">
                  <p>{t('exactDuplicateWarning')}</p>
                  <label htmlFor={`${idPrefix}-include-duplicate`}>
                    <input
                      id={`${idPrefix}-include-duplicate`}
                      type="checkbox"
                      checked={state.includeDuplicate}
                      onChange={(event) =>
                        updateRecordState(index, (prevState) => ({
                          ...prevState,
                          includeDuplicate: event.target.checked,
                        }))
                      }
                    />
                    {t('includeDuplicateLabel')}
                  </label>
                </div>
              )}

              {reviewRecord.approximateCandidates.length > 0 && (
                <div role="alert">
                  <p>{t('approximateDuplicateWarning')}</p>
                  {(
                    [
                      ['unresolved', 'approximateDuplicateUnresolved'],
                      ['confirmed_replacement', 'approximateDuplicateConfirmedReplacement'],
                      ['different_transaction', 'approximateDuplicateDifferentTransaction'],
                    ] as [ApproximateDecision, string][]
                  ).map(([value, labelKey]) => (
                    <label key={value} htmlFor={`${idPrefix}-approximate-${value}`}>
                      <input
                        id={`${idPrefix}-approximate-${value}`}
                        type="radio"
                        name={`${idPrefix}-approximate`}
                        checked={state.approximateDecision === value}
                        onChange={() =>
                          updateRecordState(index, (prevState) => ({
                            ...prevState,
                            approximateDecision: value,
                          }))
                        }
                      />
                      {t(labelKey)}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )
        })
      )}

      <div>
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
      </div>
    </div>
  )
}
