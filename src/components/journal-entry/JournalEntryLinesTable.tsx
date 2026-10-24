import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { CounterpartyQuickAddSelect } from '../counterparty-management/CounterpartyQuickAddSelect'
import { AccountSelect } from './AccountSelect'
import { isCounterpartyEligibleCategory, isManualEntryEligibleAccount, type JournalEntryFormLine } from './journalEntryFormLine'
import { calculateJournalLineTotals } from './journalLineTotals'
import './JournalEntryLinesTable.css'

/**
 * 仕訳は2件以上の明細から成るという不変条件(docs/domain/journal.md 1.1)に対応する、
 * Linesテーブル・呼び出し元(JournalEntryForm・JournalEntryDetailScreen)共通の最小行数
 * (借方・貸方の合計)。呼び出し元の行削除ロジックとJournalEntryLinesTableのminLineCount
 * 既定値の両方でこの定数を参照し、マジックナンバーの重複を避ける。
 */
export const MIN_JOURNAL_LINE_COUNT = 2

export interface JournalEntryLineRow {
  key: number
  line: JournalEntryFormLine
}

export interface JournalEntryLinesTableMasterData {
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

export interface JournalEntryLinesTableProps {
  entryDate: string
  /** 省略時は読み取り専用表示にする(JournalEntryDetailScreenでの編集はentryDate/memo/linesのみ許可、起票者は変更不可。docs/domain/journal.md参照) */
  onEntryDateChange?: (value: string) => void
  memo: string
  onMemoChange?: (value: string) => void
  headerHouseholdMemberId: number | null
  onHeaderHouseholdMemberChange?: (id: number | null) => void
  lineRows: JournalEntryLineRow[]
  onUpdateLine: (key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine) => void
  /** 借方ブロック・貸方ブロックそれぞれの「行を追加する」ボタンから、対象の側を指定して呼ばれる */
  onAddLine: (side: JournalLineSide) => void
  onRemoveLine: (key: number) => void
  /** 借方・貸方合計でこれ以下には行を減らせない。省略時MIN_JOURNAL_LINE_COUNT */
  minLineCount?: number
  masterData: JournalEntryLinesTableMasterData
  onCreateCounterparty: (name: string) => Promise<Counterparty>
}

/**
 * Entry項目(起票者・摘要・取引日)をヘッダーに持ち、借方/貸方をそれぞれ独立したブロック
 * (紙の仕訳帳のように左右に並べる)として複数行扱えるLinesテーブル(計画Issue #125)。
 * 仕訳の「入力」(JournalEntryForm)と「確認・編集」(JournalEntryDetailScreen)の両方から
 * 共通利用する。行の追加・削除・各セルの編集操作はすべて呼び出し元にコールバックで委譲し
 * (状態は持たない)、呼び出し元が下書き自動保存・確定送信・更新送信といった文脈ごとに
 * 異なる保存戦略を実装できるようにする。
 *
 * 借方行・貸方行を1対1で対応させる構造はドメイン上存在しない(JournalLineはside単位の
 * フラットな配列で件数も独立)ため、左右ブロックの行数は独立して増減する(借方4行・貸方2行
 * のような不均衡も許容する、ユーザー要望に基づく設計)。各行の側(side)はどちらのブロックに
 * 属するかで決まり、ブロック内に「借方/貸方」を選び直す欄は持たない(側を変えたい場合は
 * 削除して反対側に追加し直す)。科目・金額・プロジェクト・世帯メンバー・取引先の全フィールドを
 * 両ブロックに重複して持たせる(列数は増えるが各ブロックが独立して完結する方を優先、
 * ユーザー要望に基づく設計)。
 */
export function JournalEntryLinesTable({
  entryDate,
  onEntryDateChange,
  memo,
  onMemoChange,
  headerHouseholdMemberId,
  onHeaderHouseholdMemberChange,
  lineRows,
  onUpdateLine,
  onAddLine,
  onRemoveLine,
  minLineCount = MIN_JOURNAL_LINE_COUNT,
  masterData,
  onCreateCounterparty,
}: JournalEntryLinesTableProps) {
  const { t } = useTranslation('journal')

  const totals = calculateJournalLineTotals(lineRows.map((row) => row.line))
  // 下書きの未編集行等、側が未選択(null)のまま残っているケースは借方ブロックに寄せて表示する
  // (計画Issue #125、新規行は常にどちらかのブロックの「行を追加する」から側を指定して作られる
  // ため通常は発生しない。defensive)。
  const debitRows = lineRows.filter((row) => row.line.side !== 'credit')
  const creditRows = lineRows.filter((row) => row.line.side === 'credit')
  const canRemoveLine = lineRows.length > minLineCount

  function renderRow(row: JournalEntryLineRow): ReactNode {
    const selectedAccount = masterData.accounts.find((account) => account.id === row.line.accountId)
    const showCounterparty =
      selectedAccount !== undefined && isCounterpartyEligibleCategory(selectedAccount.category)
    /**
     * 科目に既定の世帯メンバーがある場合、明細側での上書きはDDLトリガーで禁止される
     * (docs/schema/journal.sql)。UIでも選択欄をdisabled化して通常操作では違反が
     * 起きないようにし、科目の既定値をそのまま表示する(JournalEntryFormから移植)。
     */
    const accountDefaultMemberId = selectedAccount?.householdMemberId ?? null
    const isMemberFieldDisabled = accountDefaultMemberId !== null
    const memberFieldValue = isMemberFieldDisabled
      ? accountDefaultMemberId
      : (row.line.householdMemberId ?? headerHouseholdMemberId)
    const idPrefix = `journal-entry-lines-table-row-${row.key}`

    return (
      <tr key={row.key}>
        <td>
          <AccountSelect
            id={`${idPrefix}-account`}
            label={t('lineAccountLabel')}
            value={row.line.accountId}
            accounts={masterData.accounts}
            filter={isManualEntryEligibleAccount}
            i18nNamespace="journal"
            onChange={(accountId) => {
              const account = masterData.accounts.find((candidate) => candidate.id === accountId)
              onUpdateLine(row.key, (line) => ({
                ...line,
                accountId,
                counterpartyId:
                  account !== undefined && isCounterpartyEligibleCategory(account.category)
                    ? line.counterpartyId
                    : null,
                householdMemberId:
                  account !== undefined && account.householdMemberId !== null ? null : line.householdMemberId,
              }))
            }}
          />
        </td>
        <td>
          <label htmlFor={`${idPrefix}-amount`}>{t('lineAmountLabel')}</label>
          <input
            id={`${idPrefix}-amount`}
            type="number"
            value={row.line.amountInput}
            onChange={(event) => onUpdateLine(row.key, (line) => ({ ...line, amountInput: event.target.value }))}
          />
        </td>
        <td>
          <label htmlFor={`${idPrefix}-project`}>{t('lineProjectLabel')}</label>
          <select
            id={`${idPrefix}-project`}
            value={row.line.projectId ?? ''}
            onChange={(event) =>
              onUpdateLine(row.key, (line) => ({
                ...line,
                projectId: event.target.value === '' ? null : Number(event.target.value),
              }))
            }
          >
            <option value="">{t('unselected')}</option>
            {masterData.projects
              .filter((project) => project.isActive || project.id === row.line.projectId)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </td>
        <td>
          <label htmlFor={`${idPrefix}-member`}>{t('lineHouseholdMemberLabel')}</label>
          <select
            id={`${idPrefix}-member`}
            value={memberFieldValue ?? ''}
            disabled={isMemberFieldDisabled}
            onChange={(event) =>
              onUpdateLine(row.key, (line) => ({
                ...line,
                householdMemberId: event.target.value === '' ? null : Number(event.target.value),
              }))
            }
          >
            <option value="">{t('unselected')}</option>
            {masterData.householdMembers
              .filter((member) => member.isActive || member.id === memberFieldValue)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </td>
        <td>
          {showCounterparty && (
            <CounterpartyQuickAddSelect
              id={`${idPrefix}-counterparty`}
              label={t('lineCounterpartyLabel')}
              value={row.line.counterpartyId}
              counterparties={masterData.counterparties}
              i18nNamespace="journal"
              onChange={(counterpartyId) => onUpdateLine(row.key, (line) => ({ ...line, counterpartyId }))}
              onCreate={onCreateCounterparty}
            />
          )}
        </td>
        <td>
          <button type="button" onClick={() => onRemoveLine(row.key)} disabled={!canRemoveLine}>
            {t('removeLine')}
          </button>
        </td>
      </tr>
    )
  }

  function renderBlock(side: JournalLineSide, rows: JournalEntryLineRow[]): ReactNode {
    const titleKey = side === 'debit' ? 'sideDebit' : 'sideCredit'
    const addLabelKey = side === 'debit' ? 'addDebitLine' : 'addCreditLine'

    return (
      <div className="journal-entry-lines-table-block">
        <h3>{t(titleKey)}</h3>
        <table className="journal-entry-lines-table-grid">
          <thead>
            <tr>
              <th scope="col">{t('lineAccountLabel')}</th>
              <th scope="col">{t('lineAmountLabel')}</th>
              <th scope="col">{t('lineProjectLabel')}</th>
              <th scope="col">{t('lineHouseholdMemberLabel')}</th>
              <th scope="col">{t('lineCounterpartyLabel')}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>{rows.map(renderRow)}</tbody>
        </table>
        <button type="button" onClick={() => onAddLine(side)}>
          {t(addLabelKey)}
        </button>
      </div>
    )
  }

  return (
    <div className="journal-entry-lines-table">
      <div className="journal-entry-lines-table-header">
        <div>
          <label htmlFor="journal-entry-lines-table-date">{t('entryDateLabel')}</label>
          <input
            id="journal-entry-lines-table-date"
            type="date"
            value={entryDate}
            disabled={onEntryDateChange === undefined}
            onChange={(event) => onEntryDateChange?.(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="journal-entry-lines-table-memo">{t('memoLabel')}</label>
          <input
            id="journal-entry-lines-table-memo"
            type="text"
            placeholder={t('memoPlaceholder')}
            value={memo}
            disabled={onMemoChange === undefined}
            onChange={(event) => onMemoChange?.(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="journal-entry-lines-table-household-member">{t('creatorHouseholdMemberLabel')}</label>
          <select
            id="journal-entry-lines-table-household-member"
            value={headerHouseholdMemberId ?? ''}
            disabled={onHeaderHouseholdMemberChange === undefined}
            onChange={(event) =>
              onHeaderHouseholdMemberChange?.(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('unselected')}</option>
            {masterData.householdMembers
              .filter((member) => member.isActive || member.id === headerHouseholdMemberId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="journal-entry-lines-table-blocks">
        {renderBlock('debit', debitRows)}
        {renderBlock('credit', creditRows)}
      </div>

      <div className="journal-entry-totals">
        <div>
          <span>{t('debitTotalLabel')}</span>
          <span>{formatCurrency(totals.debitTotal, 'JPY')}</span>
        </div>
        <div>
          <span>{t('creditTotalLabel')}</span>
          <span>{formatCurrency(totals.creditTotal, 'JPY')}</span>
        </div>
        <div>
          <span>{t('differenceLabel')}</span>
          <span>{formatCurrency(Math.abs(totals.difference), 'JPY')}</span>
        </div>
      </div>
    </div>
  )
}
