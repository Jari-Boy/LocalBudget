import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryLink } from '../../domain/journal/JournalEntryLink'
import type { Project } from '../../domain/project/Project'
import { findUnsettledEntries } from '../../domain/settlement/findUnsettledEntries'
import { calculateSettlementBalance } from '../../domain/settlement/calculateSettlementBalance'
import { buildSettlementJournalEntryInput } from '../../domain/settlement/buildSettlementJournalEntryInput'
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

/**
 * 精算(立替金の消込)画面(計画Issue #40)。割勘バッチ(kind='settlement'の
 * プロジェクト)・立替金科目を選択すると、A7消込ロジック(findUnsettledEntries、
 * calculateSettlementBalance)を用いて未精算の割勘仕訳を一覧表示する。各行の
 * 「精算する」操作で実際の入出金口座・金額を指定し、buildSettlementJournalEntryInput
 * (一時勘定の区分に応じて借方/貸方を決定)で組み立てた精算仕訳を起票する。
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
  const [settlementAccountId, setSettlementAccountId] = useState<number | null>(null)
  const [unsettledEntries, setUnsettledEntries] = useState<JournalEntry[] | null>(null)
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null)
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
       * 精算仕訳自体も一時勘定(立替金)行を持つため、projectEntriesの絞り込み条件
       * (project_id・accountId一致)だけでは精算対象(割勘仕訳)と精算仕訳自身を
       * 区別できない。精算仕訳はfrom_entry側でsettlesリンクを持つことを手がかりに
       * 候補から除外する(findUnallocatedEntriesの「allocatesリンクのfrom_entry側を
       * 割勘仕訳とみなす」判定と対称的な考え方)。
       */
      const settlementTargetCandidates = projectEntries.filter((entry) => {
        const links = linksByEntryId.get(entry.id) ?? []
        return !links.some((link) => link.fromEntryId === entry.id && link.linkType === 'settles')
      })
      setUnsettledEntries(findUnsettledEntries(settlementTargetCandidates, targetSettlementAccountId, linksByEntryId))
    })
  }

  if (masterData === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const settlementProjects = masterData.projects.filter((project) => project.kind === 'settlement')
  const settlementAccountCandidates = masterData.accounts.filter(
    (account) => account.category === 'asset' || account.category === 'liability',
  )
  const counterAccounts = masterData.accounts.filter((account) => account.category === 'asset')
  const selectedSettlementAccount = masterData.accounts.find((account) => account.id === settlementAccountId) ?? null

  function handleSelectProject(nextProjectId: number | null) {
    setProjectId(nextProjectId)
    setUnsettledEntries(null)
    setExpandedEntryId(null)
    if (nextProjectId !== null && settlementAccountId !== null) {
      loadUnsettled(nextProjectId, settlementAccountId)
    }
  }

  function handleSelectSettlementAccount(nextAccountId: number | null) {
    setSettlementAccountId(nextAccountId)
    setUnsettledEntries(null)
    setExpandedEntryId(null)
    if (projectId !== null && nextAccountId !== null) {
      loadUnsettled(projectId, nextAccountId)
    }
  }

  function openSettleForm(entryId: number) {
    setExpandedEntryId(entryId)
    setCounterAccountId(null)
    setAmountInput('')
    setError(null)
  }

  async function handleSettle(targetEntry: JournalEntry) {
    if (submitting || settlementAccountId === null || selectedSettlementAccount === null) return
    if (counterAccountId === null) {
      setError(t('requiredFieldMissingError'))
      return
    }
    const amount = Number(amountInput)
    if (amountInput === '' || !Number.isFinite(amount) || amount <= 0) {
      setError(t('requiredFieldMissingError'))
      return
    }

    const settlementLine = targetEntry.lines.find((line) => line.accountId === settlementAccountId)
    if (settlementLine === undefined) return

    const input = buildSettlementJournalEntryInput({
      targetEntryId: targetEntry.id,
      settlementAccountId,
      settlementAccountCategory: selectedSettlementAccount.category as 'asset' | 'liability',
      counterAccountId,
      amount,
      householdMemberId: settlementLine.householdMemberId ?? targetEntry.householdMemberId,
      projectId,
      entryDate: today ?? new Date().toISOString().slice(0, 10),
    })

    setSubmitting(true)
    setError(null)
    try {
      await journalEntryRepository.create(input)
      setExpandedEntryId(null)
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
        <label htmlFor="settlement-account">{t('settlementAccountLabel')}</label>
        <select
          id="settlement-account"
          value={settlementAccountId ?? ''}
          onChange={(event) =>
            handleSelectSettlementAccount(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {settlementAccountCandidates.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {unsettledEntries !== null &&
        (unsettledEntries.length === 0 ? (
          <p>{t('unsettledEntryListEmpty')}</p>
        ) : (
          <ul>
            {unsettledEntries.map((entry) => {
              const balance = calculateSettlementBalance(entry, settlementAccountId as number, [])
              return (
                <li key={entry.id}>
                  <div className="settlement-entry-row">
                    <span>{entry.entryDate}</span>
                    <span>{entry.memo}</span>
                    <span>{formatCurrency(balance, 'JPY')}</span>
                    <button type="button" onClick={() => openSettleForm(entry.id)}>
                      {t('settleButton')}
                    </button>
                  </div>

                  {expandedEntryId === entry.id && (
                    <div className="settlement-entry-form">
                      <label htmlFor={`settlement-counter-account-${entry.id}`}>
                        {t('counterAccountLabel')}
                      </label>
                      <select
                        id={`settlement-counter-account-${entry.id}`}
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

                      <label htmlFor={`settlement-amount-${entry.id}`}>{t('settlementAmountLabel')}</label>
                      <input
                        id={`settlement-amount-${entry.id}`}
                        type="number"
                        value={amountInput}
                        onChange={(event) => setAmountInput(event.target.value)}
                      />

                      {error !== null && <p role="alert">{error}</p>}

                      <button type="button" disabled={submitting} onClick={() => void handleSettle(entry)}>
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
