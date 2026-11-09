import type { Database } from 'sql.js'
import { buildRecurringTransactionJournalEntryInput } from '../../domain/recurring-transaction/buildRecurringTransactionJournalEntryInput'
import { evaluateRecurringTransactionProposals } from '../../domain/recurring-transaction/evaluateRecurringTransactionProposals'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import type { RecurringTransactionProposal } from '../../domain/recurring-transaction/RecurringTransactionProposal'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface ConfirmRecurringTransactionProposalInput {
  ruleId: number
  /** このルールについて現時点で最も古い保留中の対象日と一致する必要がある(昇順のみ許可) */
  dueDate: string
  /** 省略時はrule.householdMemberIdを使う。両方未指定の場合はRecurringTransactionHouseholdMemberRequiredError */
  householdMemberId?: number
  /** 省略時はrule.amountを使う(レビュー時の編集、docs/domain/recurring-transactions.md 2.1節) */
  amount?: number
}

export interface SkipRecurringTransactionProposalInput {
  ruleId: number
  /** 確定と同じく、このルールについて現時点で最も古い保留中の対象日と一致する必要がある(昇順のみ許可) */
  dueDate: string
}

export interface RecurringTransactionProposalRpcApi {
  listPending(): RecurringTransactionProposal[]
  confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry
  /**
   * 提案を見送る(計画Issue #145、docs/domain/recurring-transactions.md 1.7)。仕訳は作らず、
   * 見送った対象日だけを永続化する。見送りの取り消しは作らない(間違えて見送ったら手入力で起票する)。
   */
  skip(input: SkipRecurringTransactionProposalInput): void
}

/**
 * 定期取引の提案評価・仕訳生成(docs/domain/recurring-transactions.md 1.2節)のRPC API。
 * listPendingは呼び出しごとにルール一覧・生成済み実績をDBから読み直し、
 * evaluateRecurringTransactionProposalsで都度再評価する(提案データ自体を永続化しない、
 * 1.2節「なぜ将来分をまとめて事前生成しないか」)。
 *
 * confirmは、そのルールについて現時点で保留中の対象日一覧を再評価した上で、
 * 「最も古い保留中の対象日」と一致する場合にのみ仕訳生成を許可する(昇順のみ許可)。
 * 単純に「渡されたdueDateが最新生成entry_dateより後か」だけを見る実装では、より古い
 * 未確認の対象日を飛び越して後の対象日だけを確認できてしまい、次回以降の評価の起点
 * (最新生成entry_date)がその飛び越した対象日より後に進んでしまうことで、飛び越された
 * 対象日が仕訳化されないまま二度と提案されなくなる(evaluatorレビューAttempt 1で発見・
 * 再現された不具合、`docs/decisions.md`参照)。昇順のみ許可することで、この「実績からの
 * 逆算」方式でも取りこぼしが起こらないことを保証する。この検証はスケジュールに合致しない
 * dueDateの拒否も兼ねる(evaluateRecurringTransactionProposalsが返す候補にしか一致しない)。
 */
export function createRecurringTransactionProposalApi(
  db: Database,
  journalEntryRepository: JournalEntryRepository,
): RecurringTransactionProposalRpcApi {
  const ruleRepository = new SqlJsRecurringTransactionRuleRepository(db)
  const accountRepository = new SqlJsAccountRepository(db)

  function evaluatePendingForRule(rule: RecurringTransactionRule): RecurringTransactionProposal[] {
    return evaluateRecurringTransactionProposals(
      [
        {
          rule,
          generatedCount: ruleRepository.countGeneratedJournalEntries(rule.id),
          latestGeneratedEntryDate: ruleRepository.findLatestGeneratedEntryDate(rule.id),
          latestSkippedDueDate: ruleRepository.findLatestSkippedDueDate(rule.id),
        },
      ],
      today(),
    )
  }

  /**
   * 確定・見送りで共通の検証。そのルールの「最も古い保留中の対象日」と一致する場合にのみ許可する
   * (昇順のみ許可)。ルールを返す。
   */
  function assertNextPendingDueDate(ruleId: number, dueDate: string): RecurringTransactionRule {
    const rule = ruleRepository.findById(ruleId)
    if (!rule) {
      throw new Error(`recurring transaction rule not found: ${ruleId}`)
    }

    const [nextPending] = evaluatePendingForRule(rule)
    if (!nextPending || nextPending.dueDate !== dueDate) {
      throw new Error(
        nextPending
          ? `due date ${dueDate} is not the next pending occurrence for recurring transaction rule ${rule.id} (expected ${nextPending.dueDate}); earlier pending occurrences must be handled first`
          : `recurring transaction rule ${rule.id} has no pending occurrence for due date ${dueDate}`,
      )
    }
    return rule
  }

  return {
    listPending(): RecurringTransactionProposal[] {
      return ruleRepository.findAll().flatMap((rule) => evaluatePendingForRule(rule))
    },

    confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry {
      const rule = assertNextPendingDueDate(input.ruleId, input.dueDate)

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
          // 明細行の世帯メンバー: 科目の既定メンバー > ルールの世帯メンバー > 起票者(計画Issue #169)
          resolveLineHouseholdMemberId: createLineHouseholdMemberResolver(
            [debitAccount, creditAccount],
            bookkeeperHouseholdMemberId,
          ),
        }),
      )
    },

    skip(input: SkipRecurringTransactionProposalInput): void {
      const rule = assertNextPendingDueDate(input.ruleId, input.dueDate)
      ruleRepository.recordSkip(rule.id, input.dueDate)
    },
  }
}
