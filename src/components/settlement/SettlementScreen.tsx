import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { Project } from '../../domain/project/Project'
import { allocateSettlementToLines } from '../../domain/settlement/allocateSettlementToLines'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
import { findUnsettledLines, type UnsettledLine } from '../../domain/settlement/findUnsettledEntries'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './SettlementScreen.css'

interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  listLinksForEntry(entryId: number): JournalEntryLink[] | Promise<JournalEntryLink[]>
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

export interface SettlementScreenProps {
  projectRepository: ProjectFinder
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
  /** 精算仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  projects: Project[]
  accounts: Account[]
}

type SettlementSide = 'asset' | 'liability'

/**
 * 画面の1行(精算の単位)。1件の仕訳が持つ未消込の一時勘定行を、世帯メンバーごとに束ねたもの。
 * 通常は1仕訳1行だが、複数の元仕訳をまとめて割勘した仕訳(同じ分担者分)は一時勘定行が複数あり、
 * 精算額はそれらへ先頭から順に割り当てる(allocateSettlementToLines)。世帯メンバーの異なる
 * 一時勘定行は別の行として扱い、一方の精算で他方の債務を消し込んでしまうことはない。
 */
interface SettlementRow {
  key: string
  entry: JournalEntry
  householdMemberId: number | null
  lines: UnsettledLine[]
  balance: number
}

function groupUnsettledLines(unsettledLines: readonly UnsettledLine[]): SettlementRow[] {
  const rowsByKey = new Map<string, SettlementRow>()
  for (const unsettled of unsettledLines) {
    const memberId = unsettled.line.householdMemberId
    const key = `${unsettled.entry.id}:${memberId ?? 'none'}`
    const existing = rowsByKey.get(key)
    if (existing === undefined) {
      rowsByKey.set(key, {
        key,
        entry: unsettled.entry,
        householdMemberId: memberId,
        lines: [unsettled],
        balance: unsettled.balance,
      })
    } else {
      existing.lines.push(unsettled)
      existing.balance += unsettled.balance
    }
  }
  return Array.from(rowsByKey.values())
}
/**
 * 精算(立替金の消込)画面(計画Issue #40)。プロジェクト(kind='settlement')・
 * 精算方向を選択すると、A7消込ロジック(findUnsettledLines、明細行単位の消込残高)を用いて
 * 未精算の割勘仕訳の一時勘定行を、仕訳・世帯メンバーごとの行にまとめて一覧表示する。各行の
 * 「精算する」操作で実際の入出金口座・金額を指定し、精算額を未消込の明細行へ先頭から順に
 * 割り当てたうえで(allocateSettlementToLines)、buildSettlementJournalEntryInput
 * (一時勘定の区分に応じて借方/貸方を決定)で組み立てた精算仕訳を起票する。
 *
 * 立替金(資産/負債)科目はユーザーに選択させず、seedAdvanceAccounts(docs/domain/
 * expense-splitting.md 1.2節)が投入したis_system_managed科目を自動解決して使う
 * (計画Issue #40、人間レビューでの追加指摘への対応)。ただし精算画面では資産側
 * (自分が立て替えた分を受け取る)・負債側(自分が立て替えてもらった分を支払う)の
 * どちらを精算するかという実質的な選択は残るため、科目名ではなく「精算方向」という
 * 2択(SettlementSide)をユーザーに選ばせ、対応する科目idへ変換する。
 */
export function SettlementScreen({
  projectRepository,
  accountRepository,
  journalEntryRepository,
  onBack,
  today,
}: SettlementScreenProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [settlementSide, setSettlementSide] = useState<SettlementSide | null>(null)
  const [unsettledRows, setUnsettledRows] = useState<SettlementRow[] | null>(null)
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [counterAccountId, setCounterAccountId] = useState<number | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([Promise.resolve(projectRepository.findAll()), Promise.resolve(accountRepository.findAll())]).then(
      ([projects, accounts]) => setMasterData({ projects, accounts }),
    )
  }, [projectRepository, accountRepository])

  const loadUnsettled = (targetProjectId: number, targetSettlementAccountId: number) => {
    void Promise.resolve(journalEntryRepository.findAll()).then(async (allEntries) => {
      const projectEntries = allEntries.filter((entry) =>
        entry.lines.some((line) => line.projectId === targetProjectId && line.accountId === targetSettlementAccountId),
      )
      const linksByEntryId = new Map<number, JournalEntryLink[]>()
      await Promise.all(
        projectEntries.map(async (entry) => {
          linksByEntryId.set(entry.id, await Promise.resolve(journalEntryRepository.listLinksForEntry(entry.id)))
        }),
      )
      /**
       * 精算仕訳自体も一時勘定(立替金)行を持つが、その行はsettlesリンクのfrom_lineとして
       * 明細行単位で識別でき、findUnsettledLinesが消込対象から除く(計画Issue #132。以前は
       * 仕訳単位のリンクではタグ一致だけで精算仕訳自身と区別できず、呼び出し側で除外していた)。
       * 絞り込むのはプロジェクトのタグが付いた行のみ。
       */
      const unsettledLines = findUnsettledLines(projectEntries, targetSettlementAccountId, linksByEntryId).filter(
        ({ line }) => line.projectId === targetProjectId,
      )
      setUnsettledRows(groupUnsettledLines(unsettledLines))
    })
  }

  if (masterData === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const settlementProjects = masterData.projects.filter((project) => project.kind === 'settlement')
  const counterAccounts = masterData.accounts.filter((account) => account.category === 'asset')
  /**
   * 立替金(資産/負債)科目はユーザーに科目一覧から選ばせず、seedAdvanceAccountsが
   * 投入したis_system_managed科目を自動解決する(SettlementScreenのJSDoc参照)。
   */
  const advanceAssetAccountId =
    masterData.accounts.find((account) => account.category === 'asset' && account.isSystemManaged)?.id ?? null
  const advanceLiabilityAccountId =
    masterData.accounts.find((account) => account.category === 'liability' && account.isSystemManaged)?.id ?? null
  const settlementAccountIdBySide: Record<SettlementSide, number | null> = {
    asset: advanceAssetAccountId,
    liability: advanceLiabilityAccountId,
  }
  const settlementAccountId = settlementSide === null ? null : settlementAccountIdBySide[settlementSide]

  function handleSelectProject(nextProjectId: number | null) {
    setProjectId(nextProjectId)
    setUnsettledRows(null)
    setExpandedRowKey(null)
    if (nextProjectId !== null && settlementAccountId !== null) {
      loadUnsettled(nextProjectId, settlementAccountId)
    }
  }

  function handleSelectSettlementSide(nextSide: SettlementSide | null) {
    setSettlementSide(nextSide)
    setUnsettledRows(null)
    setExpandedRowKey(null)
    const nextAccountId = nextSide === null ? null : settlementAccountIdBySide[nextSide]
    if (projectId !== null && nextAccountId !== null) {
      loadUnsettled(projectId, nextAccountId)
    }
  }

  function openSettleForm(rowKey: string) {
    setExpandedRowKey(rowKey)
    setCounterAccountId(null)
    setAmountInput('')
    setError(null)
  }

  async function handleSettle(row: SettlementRow) {
    if (submitting || settlementAccountId === null || settlementSide === null) return
    if (counterAccountId === null) {
      setError(t('settlementFieldMissingError'))
      return
    }
    const amount = Number(amountInput)
    if (amountInput === '' || !Number.isFinite(amount) || amount <= 0) {
      setError(t('settlementFieldMissingError'))
      return
    }

    const targets = allocateSettlementToLines(
      row.lines.map(({ line, balance }) => ({ lineId: line.id, balance })),
      amount,
    )
    if (targets.length === 0) return

    const input = buildSettlementJournalEntryInput({
      targets,
      settlementAccountId,
      settlementAccountCategory: settlementSide,
      counterAccountId,
      amount,
      householdMemberId: row.householdMemberId ?? row.entry.householdMemberId,
      projectId,
      entryDate: today ?? new Date().toISOString().slice(0, 10),
    })

    setSubmitting(true)
    setError(null)
    try {
      await journalEntryRepository.create(input)
      setExpandedRowKey(null)
      if (projectId !== null && settlementAccountId !== null) {
        loadUnsettled(projectId, settlementAccountId)
      }
    } catch {
      setError(t('submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="settlement-screen">
      <h2>{t('settlementScreenTitle')}</h2>

      <div>
        <label htmlFor="settlement-project">{t('projectLabel')}</label>
        <select
          id="settlement-project"
          value={projectId ?? ''}
          onChange={(event) => handleSelectProject(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value="">{t('unselected')}</option>
          {settlementProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="settlement-account">{t('settlementSideLabel')}</label>
        <select
          id="settlement-account"
          value={settlementSide ?? ''}
          onChange={(event) =>
            handleSelectSettlementSide(event.target.value === '' ? null : (event.target.value as SettlementSide))
          }
        >
          <option value="">{t('unselected')}</option>
          <option value="asset">{t('settlementSideReceive')}</option>
          <option value="liability">{t('settlementSidePay')}</option>
        </select>
      </div>

      {unsettledRows !== null &&
        (unsettledRows.length === 0 ? (
          <p>{t('unsettledEntryListEmpty')}</p>
        ) : (
          <ul>
            {unsettledRows.map((row) => {
              const { entry, balance } = row
              return (
                <li key={row.key}>
                  <div className="settlement-entry-row">
                    <span>{entry.entryDate}</span>
                    <span>{entry.memo}</span>
                    <span>{formatCurrency(balance, 'JPY')}</span>
                    <button type="button" onClick={() => openSettleForm(row.key)}>
                      {t('settleButton')}
                    </button>
                  </div>

                  {expandedRowKey === row.key && (
                    <div className="settlement-entry-form">
                      <label htmlFor={`settlement-counter-account-${row.key}`}>
                        {t('counterAccountLabel')}
                      </label>
                      <select
                        id={`settlement-counter-account-${row.key}`}
                        value={counterAccountId ?? ''}
                        onChange={(event) =>
                          setCounterAccountId(event.target.value === '' ? null : Number(event.target.value))
                        }
                      >
                        <option value="">{t('unselected')}</option>
                        {counterAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>

                      <label htmlFor={`settlement-amount-${row.key}`}>{t('settlementAmountLabel')}</label>
                      <input
                        id={`settlement-amount-${row.key}`}
                        type="number"
                        value={amountInput}
                        onChange={(event) => setAmountInput(event.target.value)}
                      />

                      {error !== null && <p role="alert">{error}</p>}

                      <button type="button" disabled={submitting} onClick={() => void handleSettle(row)}>
                        {t('confirmSettlement')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
