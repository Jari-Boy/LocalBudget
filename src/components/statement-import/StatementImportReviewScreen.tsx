import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty, CounterpartyPattern } from '../../domain/counterparty/Counterparty'
import type { JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type { StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import {
  checkBalanceReconciliation,
  type ReconciliationLine,
} from '../../domain/reconciliation/checkBalanceReconciliation'
import {
  estimateCounterparty,
  normalizeDescriptionForMatching,
  type CounterpartyPatternLookup,
} from '../../domain/statement-import/estimateCounterparty'
import {
  suggestCounterpartyAccount,
  type CounterpartyLookup,
} from '../../domain/statement-import/suggestCounterpartyAccount'
import {
  groupUnresolvedRecordsByDescription,
  type UnresolvedRecordGroup,
} from '../../domain/statement-import/groupUnresolvedRecordsByDescription'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { isStatementImportCounterAccountEligible } from './statementImportEligibility'
import './StatementImportReviewScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface CounterpartyEstimationRepository {
  findAll(): Counterparty[] | Promise<Counterparty[]>
  findByPattern(text: string): CounterpartyPattern[] | Promise<CounterpartyPattern[]>
}

export interface StatementImportReviewScreenProps {
  targetAccount: Account
  review: StatementImportReviewResult
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  counterpartyRepository: CounterpartyEstimationRepository
  onBack: () => void
}

type ApproximateDecision = 'unresolved' | 'confirmed_replacement' | 'different_transaction'

interface RecordReviewState {
  counterpartyId: number | null
  counterAccountId: number | null
  /** 相手科目をユーザーが手動編集済みか(dirty flag)。trueの間は取引先変更による自動追従を止める(計画Issue #77設計方針1) */
  counterAccountTouched: boolean
  includeDuplicate: boolean
  approximateDecision: ApproximateDecision
}

function createInitialRecordState(counterpartyId: number | null, counterAccountId: number | null): RecordReviewState {
  return {
    counterpartyId,
    counterAccountId,
    counterAccountTouched: false,
    includeDuplicate: false,
    approximateDecision: 'unresolved',
  }
}

/**
 * 取引先推定(estimateCounterparty)・相手科目サジェスト(suggestCounterpartyAccount)は
 * 同期的なRepositoryインターフェースを要求する純粋関数(docs/architecture.md 5.1
 * ドメイン層はインフラ非依存)。Web Worker越しのCounterpartyEstimationRepositoryは
 * 非同期(PromiseまたはComlink Remote)のため、レコードに含まれるユニークな正規化摘要
 * ごとに一度だけfindByPatternを事前に呼び出してMapへ解決し、その場でのみ同期の
 * アダプタを組み立てて純粋関数へ渡す(StatementImportUploadScreen.tsxが
 * buildStatementImportReviewへ事前解決したexistingExternalIds等を渡すのと同じ方針)。
 */
async function computeInitialRecordStates(
  records: StatementImportReviewResult['records'],
  counterpartyRepository: CounterpartyEstimationRepository,
  counterparties: readonly Counterparty[],
): Promise<RecordReviewState[]> {
  const uniqueNormalizedDescriptions = [
    ...new Set(records.map((reviewRecord) => normalizeDescriptionForMatching(reviewRecord.record.description))),
  ]
  const patternsByNormalizedDescription = new Map<string, CounterpartyPattern[]>(
    await Promise.all(
      uniqueNormalizedDescriptions.map(
        async (normalized) =>
          [normalized, await Promise.resolve(counterpartyRepository.findByPattern(normalized))] as const,
      ),
    ),
  )
  const patternLookup: CounterpartyPatternLookup = {
    findByPattern: (text) => patternsByNormalizedDescription.get(text) ?? [],
  }
  const counterpartyLookup: CounterpartyLookup = {
    findById: (id) => counterparties.find((counterparty) => counterparty.id === id) ?? null,
  }

  return records.map((reviewRecord) => {
    const counterpartyId = estimateCounterparty(reviewRecord.record.description, patternLookup)
    const counterAccountId = suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
    return createInitialRecordState(counterpartyId, counterAccountId)
  })
}

/** 対象科目の永続化済み(過去分)のjournal_line。確定版候補の置き換え判定にjournalEntryIdを使う */
interface PastAccountLine {
  journalEntryId: number
  side: JournalLineSide
  amount: number
}

/**
 * CSV取込レビュー一覧画面(計画Issue #76・#77、docs/domain/statement-import.md 1.5手順2〜6)。
 * アップロード済みのレコード一覧を表示し、取引先推定(estimateCounterparty)・相手勘定科目
 * サジェスト(suggestCounterpartyAccount)の結果を初期値として表示した上でユーザーが確認・
 * 修正できるようにする。重複防止フロー(1.6)の警告表示・ユーザー選択、残高照合
 * (docs/domain/reconciliation.md 1.5)の警告表示も行う。編集内容はReact stateのみで保持し、
 * ドラフト自動保存機構(journal_entry_drafts)は流用しない(計画Issue #76制約・前提)。
 */
export function StatementImportReviewScreen({
  targetAccount,
  review,
  accountRepository,
  journalEntryRepository,
  counterpartyRepository,
  onBack,
}: StatementImportReviewScreenProps) {
  const { t } = useTranslation('statementImport')
  const { t: tCommon } = useTranslation('common')

  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [counterparties, setCounterparties] = useState<Counterparty[] | null>(null)
  /** 対象科目の永続化済み(過去分)のjournal_lines。今回アップロードしたバッチの効果は含まない */
  const [pastAccountLines, setPastAccountLines] = useState<PastAccountLine[] | null>(null)
  /** 取引先推定・相手科目サジェストの計算(computeInitialRecordStates)が完了するまではnull */
  const [recordStates, setRecordStates] = useState<RecordReviewState[] | null>(null)
  /** 一括割当てバナー(正規化後摘要ごと)で選択中の取引先。未選択は空文字 */
  const [bulkAssignSelections, setBulkAssignSelections] = useState<Record<string, string>>({})

  useEffect(() => {
    void Promise.resolve(accountRepository.findAll()).then(setAccounts)
  }, [accountRepository])

  useEffect(() => {
    void Promise.resolve(counterpartyRepository.findAll()).then(setCounterparties)
  }, [counterpartyRepository])

  useEffect(() => {
    if (counterparties === null) return
    void computeInitialRecordStates(review.records, counterpartyRepository, counterparties).then(setRecordStates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterparties, counterpartyRepository])

  useEffect(() => {
    if (targetAccount.isReconcilable !== true || review.latestExternalBalance === null) {
      setPastAccountLines(null)
      return
    }
    void Promise.resolve(journalEntryRepository.findAll()).then((entries) => {
      const accountLines = entries
        .flatMap((entry) => entry.lines)
        .filter((line) => line.accountId === targetAccount.id)
        .map((line) => ({ journalEntryId: line.journalEntryId, side: line.side, amount: line.amount }))
      setPastAccountLines(accountLines)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAccount.id, targetAccount.isReconcilable, review.latestExternalBalance, journalEntryRepository])

  function updateRecordState(index: number, updater: (state: RecordReviewState) => RecordReviewState) {
    setRecordStates((prev) => prev === null ? prev : prev.map((state, i) => (i === index ? updater(state) : state)))
  }

  if (accounts === null || counterparties === null || recordStates === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const counterAccountCandidates = accounts.filter(
    (account) => account.id !== targetAccount.id && isStatementImportCounterAccountEligible(account),
  )
  const counterpartyLookup: CounterpartyLookup = {
    findById: (id) => counterparties.find((counterparty) => counterparty.id === id) ?? null,
  }
  const externalBalance = review.latestExternalBalance

  /**
   * 取引先が特定できない(counterpartyId === null)レコードを正規化後の摘要でグルーピングし、
   * 2件以上のグループのみ一括割当てバナーの対象とする(docs/domain/statement-import.md
   * 1.5手順6、計画Issue #77設計方針3)。グループの先頭レコードのfieldsetの直前にバナーを表示する。
   */
  const unresolvedGroups = groupUnresolvedRecordsByDescription(
    review.records
      .map((reviewRecord, index) => ({ index, description: reviewRecord.record.description, state: recordStates[index] }))
      .filter(({ state }) => state.counterpartyId === null)
      .map(({ index, description }) => ({ index, description })),
  )
  const unresolvedGroupByLeadIndex = new Map(
    unresolvedGroups.map((group) => [group.recordIndices[0], group] as const),
  )

  function applyBulkAssignment(group: UnresolvedRecordGroup) {
    const selected = bulkAssignSelections[group.normalizedDescription]
    if (selected === undefined || selected === '') return
    const counterpartyId = Number(selected)
    const counterAccountId = suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
    setRecordStates((prev) =>
      prev === null
        ? prev
        : prev.map((state, i) =>
            group.recordIndices.includes(i) ? { ...state, counterpartyId, counterAccountId } : state,
          ),
    )
  }

  /**
   * 確定版候補(docs/domain/statement-import.md 1.6)で「これは確定版です」を選んだレコードは、
   * レビュー確定時に置き換え対象の旧仕訳(approximateCandidates)が削除される想定
   * (1.6「既存の仕訳を削除し、確定後の内容で取り込む」)。本Issueでは実際の削除操作(永続化)は
   * 行わないが、残高照合の見込み計算ではその旧仕訳の効果を過去分から除外しないと、旧仕訳+
   * 新レコードが二重計上され誤った不一致警告が出る。1レコードに複数の近似候補がある場合も、
   * 「これは確定版です」を選べば候補全てを除外扱いにする(候補選定は日付・金額が近いものを
   * 単純に提示するだけの設計であり、1.6の「メモ: 候補選定ロジックの方向性」の通り複雑な
   * 一意特定は行わないため、複数候補の中から1件だけを厳密に選ばせるUIは持たない)。
   */
  const replacedJournalEntryIds = new Set(
    review.records.flatMap((record, index) =>
      recordStates[index].approximateDecision === 'confirmed_replacement'
        ? record.approximateCandidates.map((candidate) => candidate.journalEntryId)
        : [],
    ),
  )

  /**
   * 残高照合(docs/domain/reconciliation.md 1.5)は「確定済みの過去分+今回取り込む分の草案」を
   * 積み上げて計算する(過去分のみでは、正しく取り込めるCSVでも誤って不一致警告が出てしまう)。
   * 重複と判定され、かつユーザーが明示的に取り込むを選択していない行(isExactDuplicate &&
   * !includeDuplicate)は実際には取り込まれないため積み上げから除外する。is_reconcilable=true
   * 科目は現状asset区分のみのため、ImportedRecord.amountの符号(正=残高が増える方向)をそのまま
   * 借方/貸方に変換できる(buildConfirmedJournalEntryInput.tsのdetermineTargetSideと同じ判定)。
   */
  const reconciliation =
    targetAccount.isReconcilable === true && pastAccountLines !== null && externalBalance !== null
      ? checkBalanceReconciliation(
          [
            ...pastAccountLines
              .filter((line) => !replacedJournalEntryIds.has(line.journalEntryId))
              .map((line): ReconciliationLine => ({ side: line.side, amount: line.amount })),
            ...review.records
              .filter((record, index) => !(record.isExactDuplicate && !recordStates[index].includeDuplicate))
              .map((record) => toReconciliationLine(record.record.amount)),
          ],
          externalBalance,
        )
      : null

  return (
    <div className="statement-import-review-screen">
      <h2>{t('reviewTitle')}</h2>

      {reconciliation && (
        <p role={reconciliation.isReconciled ? 'status' : 'alert'}>
          {reconciliation.isReconciled
            ? t('balanceReconciled')
            : t('balanceMismatchWarning', {
                bookBalance: formatCurrency(reconciliation.bookBalance, 'JPY'),
                externalBalance: formatCurrency(reconciliation.externalBalance, 'JPY'),
                difference: formatCurrency(reconciliation.difference, 'JPY'),
              })}
        </p>
      )}

      {review.records.length === 0 ? (
        <p>{t('reviewEmpty')}</p>
      ) : (
        review.records.map((reviewRecord, index) => {
          const state = recordStates[index]
          const idPrefix = `statement-import-record-${index}`
          const bulkAssignGroup = unresolvedGroupByLeadIndex.get(index)

          return (
            <div key={reviewRecord.externalId}>
              {bulkAssignGroup && (
                <div className="statement-import-bulk-assign-banner">
                  <p>{t('bulkAssignPrompt', { count: bulkAssignGroup.recordIndices.length })}</p>
                  <label htmlFor={`${idPrefix}-bulk-assign-counterparty`}>
                    {t('bulkAssignCounterpartyLabel')}
                  </label>
                  <select
                    id={`${idPrefix}-bulk-assign-counterparty`}
                    value={bulkAssignSelections[bulkAssignGroup.normalizedDescription] ?? ''}
                    onChange={(event) =>
                      setBulkAssignSelections((prev) => ({
                        ...prev,
                        [bulkAssignGroup.normalizedDescription]: event.target.value,
                      }))
                    }
                  >
                    <option value="">{t('unselected')}</option>
                    {counterparties.map((counterparty) => (
                      <option key={counterparty.id} value={counterparty.id}>
                        {counterparty.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => applyBulkAssignment(bulkAssignGroup)}>
                    {t('bulkAssignApply')}
                  </button>
                </div>
              )}
            <fieldset>
              <legend>{t('recordGroupLabel', { index: index + 1 })}</legend>

              <p>{reviewRecord.record.entryDate}</p>
              <p>{reviewRecord.record.description}</p>
              <p>{formatCurrency(reviewRecord.record.amount, 'JPY')}</p>

              <label htmlFor={`${idPrefix}-counterparty`}>{t('counterpartyLabel')}</label>
              <select
                id={`${idPrefix}-counterparty`}
                value={state.counterpartyId ?? ''}
                onChange={(event) => {
                  const counterpartyId = event.target.value === '' ? null : Number(event.target.value)
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    counterpartyId,
                    // 相手科目が未編集(dirty flag無し)の間は取引先変更のたびに再サジェストして
                    // 追従する。手動編集済みなら上書きしない(計画Issue #77設計方針1)
                    counterAccountId: prevState.counterAccountTouched
                      ? prevState.counterAccountId
                      : suggestCounterpartyAccount(counterpartyId, counterpartyLookup),
                  }))
                }}
              >
                <option value="">{t('unselected')}</option>
                {counterparties.map((counterparty) => (
                  <option key={counterparty.id} value={counterparty.id}>
                    {counterparty.name}
                  </option>
                ))}
              </select>

              <label htmlFor={`${idPrefix}-counter-account`}>{t('counterAccountLabel')}</label>
              <select
                id={`${idPrefix}-counter-account`}
                value={state.counterAccountId ?? ''}
                onChange={(event) =>
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    counterAccountId: event.target.value === '' ? null : Number(event.target.value),
                    counterAccountTouched: true,
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
            </div>
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

function toReconciliationLine(amount: number): ReconciliationLine {
  return amount >= 0 ? { side: 'debit', amount } : { side: 'credit', amount: -amount }
}
