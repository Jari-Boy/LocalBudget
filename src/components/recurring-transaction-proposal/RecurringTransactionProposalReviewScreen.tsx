import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { RecurringTransactionProposal } from '../../domain/recurring-transaction/RecurringTransactionProposal'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import './RecurringTransactionProposalReviewScreen.css'

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface RuleFinder {
  findAll(): RecurringTransactionRule[] | Promise<RecurringTransactionRule[]>
}
interface ProposalConfirmInput {
  ruleId: number
  dueDate: string
  householdMemberId?: number
  amount?: number
}
interface ProposalApi {
  listPending(): RecurringTransactionProposal[] | Promise<RecurringTransactionProposal[]>
  confirm(input: ProposalConfirmInput): JournalEntry | Promise<JournalEntry>
}

export interface RecurringTransactionProposalReviewScreenProps {
  recurringTransactionProposalApi: ProposalApi
  recurringTransactionRuleRepository: RuleFinder
  householdMemberRepository: HouseholdMemberFinder
  onBack: () => void
}

interface OldestProposalByRule {
  rule: RecurringTransactionRule
  dueDate: string
  /** このルールについて、oldest以外にも保留中の対象日がいくつあるか(1.2節、古い順のみ確認可能) */
  otherPendingCount: number
}

interface LoadedData {
  oldestProposals: OldestProposalByRule[]
  householdMembers: HouseholdMember[]
}

interface RowInputState {
  amountInput: string
  householdMemberIdInput: number | ''
}

function groupOldestPendingProposalByRule(
  proposals: RecurringTransactionProposal[],
  rules: RecurringTransactionRule[],
): OldestProposalByRule[] {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
  const proposalsByRuleId = new Map<number, RecurringTransactionProposal[]>()
  for (const proposal of proposals) {
    const list = proposalsByRuleId.get(proposal.ruleId) ?? []
    list.push(proposal)
    proposalsByRuleId.set(proposal.ruleId, list)
  }

  const result: OldestProposalByRule[] = []
  for (const [ruleId, rulePendingProposals] of proposalsByRuleId) {
    const rule = ruleById.get(ruleId)
    if (!rule) continue
    const sorted = [...rulePendingProposals].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    result.push({ rule, dueDate: sorted[0].dueDate, otherPendingCount: sorted.length - 1 })
  }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/**
 * 定期取引の提案レビュー画面(計画Issue #39)。#121が提供する
 * recurringTransactionProposal RPC(listPending/confirm)を呼び出し、保留中の提案の一覧表示と
 * レビュー確認→仕訳生成のフローを提供する。評価ロジック自体はここでは実装しない。
 *
 * confirmは「そのルールについて現時点で保留中の対象日のうち最も古いもの」としか一致しない
 * 場合を拒否する(docs/decisions.md 2026-09-12)。この制約をUI側で回避することはできないため、
 * ルールごとに最も古い保留中の対象日のみを確認可能な行として表示し、それ以外の保留中対象日は
 * 確認フォームを出さずに件数のみを示す(古い順にしか確認できない導線)。
 *
 * amountはレビュー時に編集可能(2.1節)。ルールにhouseholdMemberIdが設定されていない場合は
 * RecurringTransactionHouseholdMemberRequiredErrorを送出しうるため(起票者を解決できない)、
 * 事前に世帯メンバー選択欄を表示し選択するまで確認ボタンを無効化する。
 */
export function RecurringTransactionProposalReviewScreen({
  recurringTransactionProposalApi,
  recurringTransactionRuleRepository,
  householdMemberRepository,
  onBack,
}: RecurringTransactionProposalReviewScreenProps) {
  const { t } = useTranslation('recurringTransaction')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [rowInputs, setRowInputs] = useState<Map<number, RowInputState>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const load = () => {
    void Promise.all([
      Promise.resolve(recurringTransactionProposalApi.listPending()),
      Promise.resolve(recurringTransactionRuleRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
    ]).then(([proposals, rules, householdMembers]) => {
      const oldestProposals = groupOldestPendingProposalByRule(proposals, rules)
      setRowInputs((prev) => {
        const next = new Map<number, RowInputState>()
        for (const { rule } of oldestProposals) {
          next.set(
            rule.id,
            prev.get(rule.id) ?? {
              amountInput: String(rule.amount),
              householdMemberIdInput: rule.householdMemberId ?? '',
            },
          )
        }
        return next
      })
      setData({ oldestProposals, householdMembers })
    })
  }

  useEffect(load, [recurringTransactionProposalApi, recurringTransactionRuleRepository, householdMemberRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const confirmProposal = (item: OldestProposalByRule) => {
    if (isSubmitting) return
    const input = rowInputs.get(item.rule.id)
    if (!input) return
    setIsSubmitting(true)
    setError(null)
    const amount = Number(input.amountInput)
    void Promise.resolve(
      recurringTransactionProposalApi.confirm({
        ruleId: item.rule.id,
        dueDate: item.dueDate,
        amount: input.amountInput === '' || !Number.isFinite(amount) ? undefined : amount,
        householdMemberId: input.householdMemberIdInput === '' ? undefined : input.householdMemberIdInput,
      }),
    )
      .then(load)
      .catch((caught: unknown) => {
        setError(
          caught instanceof RecurringTransactionHouseholdMemberRequiredError
            ? t('householdMemberRequiredLabel')
            : t('confirmError'),
        )
      })
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="recurring-transaction-proposal-review-screen">
      <h2>{t('proposalReviewTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.oldestProposals.length === 0 ? (
        <p>{t('proposalListEmpty')}</p>
      ) : (
        <ul>
          {data.oldestProposals.map((item) => {
            const input = rowInputs.get(item.rule.id) ?? {
              amountInput: String(item.rule.amount),
              householdMemberIdInput: item.rule.householdMemberId ?? '',
            }
            const needsHouseholdMember = item.rule.householdMemberId === null
            const canConfirm = !needsHouseholdMember || input.householdMemberIdInput !== ''
            const amountFieldId = `recurring-proposal-amount-${item.rule.id}`
            const householdMemberFieldId = `recurring-proposal-household-member-${item.rule.id}`

            return (
              <li key={item.rule.id}>
                <div className="recurring-transaction-proposal-row">
                  <span className="recurring-transaction-proposal-name">{item.rule.name}</span>
                  <span className="recurring-transaction-proposal-due-date">{item.dueDate}</span>
                </div>

                <label htmlFor={amountFieldId}>{t('amountLabel')}</label>
                <input
                  id={amountFieldId}
                  type="number"
                  value={input.amountInput}
                  onChange={(event) =>
                    setRowInputs((prev) => {
                      const next = new Map(prev)
                      next.set(item.rule.id, { ...input, amountInput: event.target.value })
                      return next
                    })
                  }
                />

                {needsHouseholdMember && (
                  <>
                    <label htmlFor={householdMemberFieldId}>{t('householdMemberRequiredLabel')}</label>
                    <select
                      id={householdMemberFieldId}
                      value={input.householdMemberIdInput}
                      onChange={(event) =>
                        setRowInputs((prev) => {
                          const next = new Map(prev)
                          next.set(item.rule.id, {
                            ...input,
                            householdMemberIdInput: event.target.value === '' ? '' : Number(event.target.value),
                          })
                          return next
                        })
                      }
                    >
                      <option value="">{t('unselected')}</option>
                      {data.householdMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <button type="button" onClick={() => confirmProposal(item)} disabled={!canConfirm || isSubmitting}>
                  {t('confirmButton')}
                </button>

                {item.otherPendingCount > 0 && (
                  <p className="recurring-transaction-proposal-other-pending">
                    {t('otherPendingCount', { count: item.otherPendingCount })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
