import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { CounterpartyQuickAddSelect } from '../counterparty-management/CounterpartyQuickAddSelect'
import { AccountSelect } from './AccountSelect'
import {
  isCounterpartyEligibleCategory,
  isLineEmpty,
  isManualEntryEligibleAccount,
  type JournalEntryFormLine,
} from './journalEntryFormLine'
import { calculateJournalLineTotals } from './journalLineTotals'
import './JournalEntryLinesTable.css'

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
  /**
   * ブロック(借方/貸方)の最終行が入力され空でなくなった際、JournalEntryLinesTable自身が
   * 自動的に呼ぶ(行追加ボタンは廃止、計画Issue #125)。呼び出し元は新しい空行を
   * lineRowsへ追加する(キー採番を含む)責務のみ持つ。
   */
  onAddLine: (side: JournalLineSide) => void
  onRemoveLine: (key: number) => void
  masterData: JournalEntryLinesTableMasterData
  onCreateCounterparty: (name: string) => Promise<Counterparty>
}

/**
 * Entry項目(起票者・摘要・取引日)をヘッダーに持ち、借方/貸方をそれぞれ独立したブロック
 * (紙の仕訳帳のように左右に並べる)として複数行扱えるLinesテーブル(計画Issue #125)。
 * 仕訳の「入力」(JournalEntryForm)と「確認・編集」(JournalEntryDetailScreen)の両方から
 * 共通利用する。各行はtableの行ではなく、科目・金額を上段、取引先・プロジェクトを中段、
 * 世帯メンバー・金額を下段に配置するカード(ユーザー指定のレイアウト)として表示する。
 * 行の追加・削除・各セルの編集操作はすべて呼び出し元にコールバックで委譲し(状態は持たない)、
 * 呼び出し元が下書き自動保存・確定送信・更新送信といった文脈ごとに異なる保存戦略を
 * 実装できるようにする。
 *
 * 行追加ボタンは持たず、各ブロックは常に末尾に1行は空行を保つ(スプレッドシート的に、
 * 最終行の何らかのフィールドが入力された瞬間に次の空行が自動で現れる)。この不変条件は
 * useEffectでlineRowsの変化を監視し、ブロックの最終行が空でなければonAddLineを呼ぶ形で
 * 実現する(初期表示時・既存データ読み込み時にも同様に働く)。行の削除は、残り1行のみの
 * ブロックでは無効化する(空行の入力欄が消えてしまうことを防ぐ。自動追加との組み合わせで
 * 実質「ブロックは常に1行以上」が保たれる)。
 *
 * 借方行・貸方行を1対1で対応させる構造はドメイン上存在しない(JournalLineはside単位の
 * フラットな配列で件数も独立)ため、左右ブロックの行数は独立して増減する(借方4行・貸方2行
 * のような不均衡も許容する、ユーザー要望に基づく設計)。科目・金額・プロジェクト・
 * 世帯メンバー・取引先の全フィールドを両ブロックに重複して持たせる(ユーザー要望に基づく設計)。
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
  masterData,
  onCreateCounterparty,
}: JournalEntryLinesTableProps) {
  const { t } = useTranslation('journal')

  const totals = calculateJournalLineTotals(lineRows.map((row) => row.line))
  // 下書きの未編集行等、側が未選択(null)のまま残っているケースは借方ブロックに寄せて表示する
  // (計画Issue #125、新規行は常にどちらかのブロックの自動追加によって側を指定して作られる
  // ため通常は発生しない。defensive)。
  const debitRows = lineRows.filter((row) => row.line.side !== 'credit')
  const creditRows = lineRows.filter((row) => row.line.side === 'credit')

  useEffect(() => {
    if (debitRows.length === 0 || !isLineEmpty(debitRows[debitRows.length - 1].line)) {
      onAddLine('debit')
    }
    if (creditRows.length === 0 || !isLineEmpty(creditRows[creditRows.length - 1].line)) {
      onAddLine('credit')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineRows])

  function renderRow(row: JournalEntryLineRow, rows: JournalEntryLineRow[]): ReactNode {
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
    const canRemove = rows.length > 1

    return (
      <div className="journal-entry-line-card" key={row.key}>
        <button
          type="button"
          className="journal-entry-line-card-remove"
          onClick={() => onRemoveLine(row.key)}
          disabled={!canRemove}
          aria-label={t('removeLine')}
        >
          🗑
        </button>
        <div className="journal-entry-line-card-grid">
          <div className="journal-entry-line-card-field journal-entry-line-card-field-account">
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
          </div>

          <div className="journal-entry-line-card-field journal-entry-line-card-field-counterparty">
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
          </div>

          <div className="journal-entry-line-card-field journal-entry-line-card-field-project">
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
          </div>

          <div className="journal-entry-line-card-field journal-entry-line-card-field-member">
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
          </div>

          <div className="journal-entry-line-card-field journal-entry-line-card-field-amount">
            <label htmlFor={`${idPrefix}-amount`}>{t('lineAmountLabel')}</label>
            <input
              id={`${idPrefix}-amount`}
              type="number"
              value={row.line.amountInput}
              onChange={(event) => onUpdateLine(row.key, (line) => ({ ...line, amountInput: event.target.value }))}
            />
          </div>
        </div>
      </div>
    )
  }

  function renderBlock(side: JournalLineSide, rows: JournalEntryLineRow[]): ReactNode {
    const titleKey = side === 'debit' ? 'sideDebit' : 'sideCredit'

    return (
      <div className="journal-entry-lines-table-block">
        <h3>{t(titleKey)}</h3>
        <div className="journal-entry-line-cards">{rows.map((row) => renderRow(row, rows))}</div>
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
