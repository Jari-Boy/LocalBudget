import { useEffect, useRef, type ReactNode } from 'react'
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

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>
)

/**
 * Entry項目(起票者・摘要・取引日)をヘッダーに持ち、借方/貸方の明細を1枚の連結した表として
 * 扱えるLinesテーブル(計画Issue #125)。仕訳の「入力」(JournalEntryForm)と「確認・編集」
 * (JournalEntryDetailScreen)の両方から共通利用する。借方ブロック・貸方ブロックは列として
 * 並べ、行(明細)はtrで罫線を共有する(浮いた個別カードではなく「1つの仕訳」として
 * 見える連結表にする、ユーザーレビューでの指摘対応)。各行内は科目を上段、取引先・
 * プロジェクトを中段、世帯メンバー・金額を下段に配置する2列グリッド(ユーザー指定の
 * レイアウト)。借方/貸方の行数は独立して増減しうる(ドメイン上、両者を1対1対応させる
 * 構造は存在しない)ため、表示上は行番号で両ブロックを並べ、短い側は空セルにする
 * (あくまで表示上の位置揃えであり、行番号に意味上の対応関係は無い)。借方合計・貸方合計は
 * 別枠ではなく表の最終行(tfoot)に統合する。
 *
 * 行追加ボタンは持たず、各ブロックは常に末尾に1行は空行を保つ(スプレッドシート的に、
 * 最終行の何らかのフィールドが入力された瞬間に次の空行が自動で現れる)。この不変条件は
 * useEffectでlineRowsの変化を監視し、ブロックの最終行が空でなければonAddLineを呼ぶ形で
 * 実現する(初期表示時・既存データ読み込み時にも同様に働く)。React18のStrictMode(開発時)は
 * マウント時にeffectを2回実行するため、素朴にonAddLineを呼ぶと1回の追加要求に対し2行
 * 追加されてしまう不具合があった(ユーザーの実機確認で発覚)。lineRowsの参照をrefで記録し、
 * 同一参照に対して二重に処理しないことで防いでいる(StrictModeの2回目の実行は同一レンダーの
 * 同一lineRows参照に対して行われるため、参照比較で確実に検出できる)。行の削除は、残り1行の
 * みのブロックでは無効化する(自動追加と組み合わせて「ブロックは常に1行以上」を保つ)。
 *
 * 科目・金額・プロジェクト・世帯メンバー・取引先の全フィールドを両ブロックに重複して
 * 持たせる(ユーザー要望に基づく設計)。取引先は選択した科目がPL科目(収益/費用)でない場合、
 * 非表示にするのではなく選択欄自体を無効化(グレー表示+ラベルに🔒)して「操作を受け付けない」
 * ことを明示する(ユーザーレビューでの指摘対応。科目に既定の世帯メンバーがある場合の
 * 世帯メンバー欄の無効化と同じ表現に揃える)。
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

  const processedLineRowsRef = useRef<JournalEntryLineRow[] | null>(null)
  useEffect(() => {
    // StrictMode(開発時)はeffectを2回実行するが、2回目は同一レンダーの同一lineRows参照に
    // 対して呼ばれる。参照が前回処理済みと同じなら何もしないことで、1回の「空行が必要」
    // 判定につき1回だけonAddLineを呼ぶことを保証する(二重追加バグの防止)。
    if (processedLineRowsRef.current === lineRows) return
    processedLineRowsRef.current = lineRows

    if (debitRows.length === 0 || !isLineEmpty(debitRows[debitRows.length - 1].line)) {
      onAddLine('debit')
    }
    if (creditRows.length === 0 || !isLineEmpty(creditRows[creditRows.length - 1].line)) {
      onAddLine('credit')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineRows])

  function renderCell(row: JournalEntryLineRow | undefined, rows: JournalEntryLineRow[]): ReactNode {
    if (row === undefined) {
      return <td className="journal-entry-lines-table-cell journal-entry-lines-table-cell-empty"></td>
    }

    const selectedAccount = masterData.accounts.find((account) => account.id === row.line.accountId)
    const isCounterpartyFieldDisabled =
      selectedAccount === undefined || !isCounterpartyEligibleCategory(selectedAccount.category)
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
      <td className="journal-entry-lines-table-cell" key={row.key}>
        <div className="journal-entry-line-cell-inner">
          <button
            type="button"
            className="journal-entry-line-cell-remove"
            onClick={() => onRemoveLine(row.key)}
            disabled={!canRemove}
            aria-label={t('removeLine')}
          >
            <TrashIcon />
          </button>
          <div className="journal-entry-line-cell-grid">
            <div className="journal-entry-line-cell-field journal-entry-line-cell-field-account">
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

            <div className="journal-entry-line-cell-field journal-entry-line-cell-field-counterparty">
              <CounterpartyQuickAddSelect
                id={`${idPrefix}-counterparty`}
                label={`${t('lineCounterpartyLabel')}${isCounterpartyFieldDisabled ? ' 🔒' : ''}`}
                value={row.line.counterpartyId}
                counterparties={masterData.counterparties}
                i18nNamespace="journal"
                disabled={isCounterpartyFieldDisabled}
                onChange={(counterpartyId) => onUpdateLine(row.key, (line) => ({ ...line, counterpartyId }))}
                onCreate={onCreateCounterparty}
              />
            </div>

            <div className="journal-entry-line-cell-field journal-entry-line-cell-field-project">
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

            <div className="journal-entry-line-cell-field journal-entry-line-cell-field-member">
              <label htmlFor={`${idPrefix}-member`}>
                {t('lineHouseholdMemberLabel')}
                {isMemberFieldDisabled ? ' 🔒' : ''}
              </label>
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

            <div className="journal-entry-line-cell-field journal-entry-line-cell-field-amount">
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
      </td>
    )
  }

  const rowCount = Math.max(debitRows.length, creditRows.length)
  const pairedRows = Array.from({ length: rowCount }, (_, index) => ({
    debit: debitRows[index],
    credit: creditRows[index],
  }))

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

      <table className="journal-entry-lines-table-grid">
        <thead>
          <tr>
            <th scope="col">{t('sideDebit')}</th>
            <th scope="col">{t('sideCredit')}</th>
          </tr>
        </thead>
        <tbody>
          {pairedRows.map((pair, index) => (
            <tr key={pair.debit?.key ?? `empty-debit-${index}`}>
              {renderCell(pair.debit, debitRows)}
              {renderCell(pair.credit, creditRows)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="journal-entry-lines-table-totals-cell">
              <span>{t('debitTotalLabel')}</span>
              <span>{formatCurrency(totals.debitTotal, 'JPY')}</span>
            </td>
            <td className="journal-entry-lines-table-totals-cell">
              <span>{t('creditTotalLabel')}</span>
              <span>{formatCurrency(totals.creditTotal, 'JPY')}</span>
            </td>
          </tr>
          <tr>
            <td className="journal-entry-lines-table-totals-cell" colSpan={2}>
              <span>{t('differenceLabel')}</span>
              <span>{formatCurrency(Math.abs(totals.difference), 'JPY')}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
