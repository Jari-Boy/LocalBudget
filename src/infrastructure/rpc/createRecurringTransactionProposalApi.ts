import type { Database } from 'sql.js'
import { buildRecurringTransactionJournalEntryInput } from '../../domain/recurring-transaction/buildRecurringTransactionJournalEntryInput'
import { evaluateRecurringTransactionProposals } from '../../domain/recurring-transaction/evaluateRecurringTransactionProposals'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import type { RecurringTransactionProposal } from '../../domain/recurring-transaction/RecurringTransactionProposal'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'

export interface ConfirmRecurringTransactionProposalInput {
  ruleId: number
  /** listPending()が返した対象日のいずれかである必要がある */
  dueDate: string
  /** 省略時はrule.householdMemberIdを使う。両方未指定の場合はRecurringTransactionHouseholdMemberRequiredError */
  householdMemberId?: number
  /** 省略時はrule.amountを使う(レビュー時の編集、docs/domain/recurring-transactions.md 2.1節) */
  amount?: number
}

export interface RecurringTransactionProposalRpcApi {
  listPending(): RecurringTransactionProposal[]
  confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry
}

/**
 * 定期取引の提案評価・仕訳生成(docs/domain/recurring-transactions.md 1.2節)のRPC API。
 * listPendingは呼び出しごとにルール一覧・生成済み実績をDBから読み直し、
 * evaluateRecurringTransactionProposalsで都度再評価する(提案データ自体を永続化しない、
 * 1.2節「なぜ将来分をまとめて事前生成しないか」)。confirmはdueDateが既に処理済み(最新の
 * 生成済みentry_date以前)でないことを確認した上で、CreateJournalEntryInputを組み立てて
 * JournalEntryRepository.createへそのまま委譲する(貸借バランス検証等は既存のRepository層に
 * 委ねる)。
 */
export function createRecurringTransactionProposalApi(
  db: Database,
  journalEntryRepository: JournalEntryRepository,
): RecurringTransactionProposalRpcApi {
  const ruleRepository = new SqlJsRecurringTransactionRuleRepository(db)
  const accountRepository = new SqlJsAccountRepository(db)

  return {
    listPending(): RecurringTransactionProposal[] {
      const today = new Date().toISOString().slice(0, 10)
      const ruleStates = ruleRepository.findAll().map((rule) => ({
        rule,
        generatedCount: ruleRepository.countGeneratedJournalEntries(rule.id),
        latestGeneratedEntryDate: ruleRepository.findLatestGeneratedEntryDate(rule.id),
      }))
      return evaluateRecurringTransactionProposals(ruleStates, today)
    },

    confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry {
      const rule = ruleRepository.findById(input.ruleId)
      if (!rule) {
        throw new Error(`recurring transaction rule not found: ${input.ruleId}`)
      }

      const latestGeneratedEntryDate = ruleRepository.findLatestGeneratedEntryDate(rule.id)
      if (latestGeneratedEntryDate !== null && input.dueDate <= latestGeneratedEntryDate) {
        throw new Error(
          `due date ${input.dueDate} has already been processed for recurring transaction rule ${rule.id}`,
        )
      }

      const bookkeeperHouseholdMemberId = rule.householdMemberId ?? input.householdMemberId
      if (bookkeeperHouseholdMemberId == null) {
        throw new RecurringTransactionHouseholdMemberRequiredError(rule.id)
      }

      const debitAccount = accountRepository.findById(rule.debitAccountId)
      const creditAccount = accountRepository.findById(rule.creditAccountId)
      if (!debitAccount || !creditAccount) {
        throw new Error(`recurring transaction rule ${rule.id} references a missing account`)
      }

      return journalEntryRepository.create(
        buildRecurringTransactionJournalEntryInput({
          rule,
          dueDate: input.dueDate,
          bookkeeperHouseholdMemberId,
          debitAccountCategory: debitAccount.category,
          creditAccountCategory: creditAccount.category,
          amount: input.amount,
        }),
      )
    },
  }
}
