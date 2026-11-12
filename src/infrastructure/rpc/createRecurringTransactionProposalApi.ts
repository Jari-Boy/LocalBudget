import type { Database } from 'sql.js'
import { adjustForWeekend } from '../../domain/recurring-transaction/adjustForWeekend'
import {
  buildRecurringTransactionJournalEntryInput,
  type EditedRecurringJournalLine,
} from '../../domain/recurring-transaction/buildRecurringTransactionJournalEntryInput'
import { scheduleAmountsForRound } from '../../domain/recurring-transaction/recurringAmountSchedule'
import { resolveLastConfirmedLines } from '../../domain/recurring-transaction/resolveLastConfirmedLines'
import { evaluateRecurringTransactionProposals } from '../../domain/recurring-transaction/evaluateRecurringTransactionProposals'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import type { RecurringTransactionProposal } from '../../domain/recurring-transaction/RecurringTransactionProposal'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import type { AccountCategory } from '../../domain/account/Account'
import type {
  RecurringTransactionRule,
  RecurringTransactionRuleLine,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 保留中の提案と、確認パネルに出す派生情報(計画Issue #164)。対象日(dueDate)は土日の調整前の期日で、
 * 提案の識別(確定・見送り)に使う。
 */
export interface PendingRecurringTransactionProposal extends RecurringTransactionProposal {
  /** 土日の調整後の日付。確定すると仕訳のentry_dateになる */
  entryDate: string
  /**
   * 確認パネルの行の初期値(計画Issue #180)。金額の初期値が固定ならルールの行のまま、前回確定額なら
   * 前回の仕訳と科目・借方/貸方が一致する行だけ前回の金額に置き換えた行(一致しない行はルールの金額)
   */
  defaultLines: RecurringTransactionRuleLine[]
  /** 一覧に出す金額(初期値の借方の合計) */
  defaultAmount: number
}

export interface ConfirmRecurringTransactionProposalInput {
  ruleId: number
  /** このルールについて現時点で最も古い保留中の対象日と一致する必要がある(昇順のみ許可) */
  dueDate: string
  /** 省略時はrule.bookkeeperHouseholdMemberIdを使う。両方未指定の場合はRecurringTransactionHouseholdMemberRequiredError */
  householdMemberId?: number
  /**
   * 確認パネルで編集した行(計画Issue #180、科目・金額の変更、行の追加・削除)。省略時は行の初期値
   * (defaultLines)のまま確定する。貸借の検証は仕訳のRepositoryが行う
   */
  lines?: EditedRecurringJournalLine[]
  /** 摘要(計画Issue #164)。省略時はルール名。空(空白のみ)なら摘要なし */
  memo?: string | null
  /** コメント(計画Issue #164)。省略時はなし */
  comment?: string | null
}

export interface ConfirmManyRecurringTransactionProposalsInput {
  /**
   * まとめて確定する提案。同じルールの提案は、古いほうから途切れずに選ばれている必要がある
   * (保留中の提案のうち古いものから連続した先頭の部分でなければエラー)。重複も不可
   */
  items: ReadonlyArray<{ ruleId: number; dueDate: string }>
  /** 起票者が決まっていないルールの分に使う起票者。起票者が決まっているルールには影響しない */
  householdMemberId?: number
}

export interface SkipRecurringTransactionProposalInput {
  ruleId: number
  /** 確定と同じく、このルールについて現時点で最も古い保留中の対象日と一致する必要がある(昇順のみ許可) */
  dueDate: string
}

export interface RecurringTransactionProposalRpcApi {
  listPending(): PendingRecurringTransactionProposal[]
  confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry
  /**
   * 複数の提案を、金額の初期値・摘要の既定(ルール名)のまま、単一のDBトランザクションでまとめて確定する
   * (計画Issue #164)。全件確定するか、1件も確定しないかのどちらか。作成した仕訳を、ルールの出現順・
   * ルール内は古い期日の順に返す。金額を直したい提案は、従来どおり1件ずつconfirmする
   */
  confirmMany(input: ConfirmManyRecurringTransactionProposalsInput): JournalEntry[]
  /**
   * 提案を見送る(計画Issue #145、docs/domain/recurring-transactions.md 1.7)。仕訳は作らず、
   * 見送った対象日(土日の調整前の期日)だけを永続化する。見送りの取り消しは作らない(間違えて見送ったら手入力で起票する)。
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
 * 単純に「渡されたdueDateが最新生成の期日より後か」だけを見る実装では、より古い
 * 未確認の対象日を飛び越えて後の対象日だけを確認できてしまい、次回以降の評価の起点
 * (最新生成の期日)がその飛び越した対象日より後に進んでしまうことで、飛び越された
 * 対象日が仕訳化されないまま二度と提案されなくなる(evaluatorレビューAttempt 1で発見・
 * 再現された不具合、`docs/decisions.md`参照)。昇順のみ許可することで、この「実績からの
 * 逆算」方式でも取りこぼしが起こらないことを保証する。この検証はスケジュールに合致しない
 * dueDateの拒否も兼ねる(evaluateRecurringTransactionProposalsが返す候補にしか一致しない)。
 *
 * 起点は生成済みの仕訳の期日(recurring_due_date)で求めるため、土日の調整や仕訳の日付の編集で
 * ずれない(計画Issue #164)。confirmManyは同じ検証を「古いものから連続した先頭の部分」に広げたもの。
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
          latestGeneratedDueDate: ruleRepository.findLatestGeneratedDueDate(rule.id),
          latestSkippedDueDate: ruleRepository.findLatestSkippedDueDate(rule.id),
        },
      ],
      today(),
    )
  }

  function findRule(ruleId: number): RecurringTransactionRule {
    const rule = ruleRepository.findById(ruleId)
    if (!rule) {
      throw new Error(`recurring transaction rule not found: ${ruleId}`)
    }
    return rule
  }

  /**
   * 行の初期値(計画Issue #180)。固定ならルールの行のまま、前回確定額なら前回の仕訳と対応づけた金額に置き換え、
   * 金額表なら「生成済みの件数+1+offset」回目の金額にする(offsetは、同時に保留中の提案の何件目か。見送りは
   * 生成済みの件数に数えないので回は進まない)。金額が0の行もそのまま返す(仕訳を作るときに除く)
   */
  function defaultLinesOf(rule: RecurringTransactionRule, offset = 0): RecurringTransactionRuleLine[] {
    if (rule.amountMode === 'schedule') {
      const amounts = scheduleAmountsForRound(rule.schedule, ruleRepository.countGeneratedJournalEntries(rule.id) + 1 + offset)
      return rule.lines.map((line) => ({ ...line, amount: amounts?.get(line.lineNo) ?? line.amount }))
    }
    if (rule.amountMode === 'last_confirmed') {
      return resolveLastConfirmedLines(rule.lines, ruleRepository.findLastConfirmedLines(rule.id))
    }
    return rule.lines
  }

  function debitTotalOf(lines: readonly RecurringTransactionRuleLine[]): number {
    return lines.filter((l) => l.side === 'debit').reduce((total, l) => total + l.amount, 0)
  }

  /**
   * 確定・見送りで共通の検証。そのルールの「最も古い保留中の対象日」と一致する場合にのみ許可する
   * (昇順のみ許可)。ルールを返す。
   */
  function assertNextPendingDueDate(ruleId: number, dueDate: string): RecurringTransactionRule {
    const rule = findRule(ruleId)

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

  /** 確定・まとめて確定で共通の、提案1件分の仕訳の入力を組み立てる(検証済みのルール・期日を前提とする) */
  function buildJournalEntryInput(
    rule: RecurringTransactionRule,
    dueDate: string,
    options: {
      householdMemberId?: number
      defaultLines: readonly RecurringTransactionRuleLine[]
      lines?: readonly EditedRecurringJournalLine[]
      memo?: string | null
      comment?: string | null
    },
  ): CreateJournalEntryInput {
    const bookkeeperHouseholdMemberId = rule.bookkeeperHouseholdMemberId ?? options.householdMemberId
    if (bookkeeperHouseholdMemberId == null) {
      throw new RecurringTransactionHouseholdMemberRequiredError(rule.id)
    }

    // 行で使う科目(ルールの行と、編集した行)を読み、区分(取引先の設置判定)と既定メンバーを解決する
    const accountIds = new Set([...rule.lines, ...(options.lines ?? [])].map((l) => l.accountId))
    const accounts = [...accountIds].map((accountId) => {
      const account = accountRepository.findById(accountId)
      if (!account) {
        throw new Error(`recurring transaction rule ${rule.id} references a missing account`)
      }
      return account
    })
    const accountCategoryById = new Map<number, AccountCategory>(accounts.map((a) => [a.id, a.category]))

    return buildRecurringTransactionJournalEntryInput({
      rule,
      dueDate,
      bookkeeperHouseholdMemberId,
      accountCategoryById,
      lineAmounts: new Map(options.defaultLines.map((l) => [l.lineNo, l.amount])),
      lines: options.lines,
      memo: options.memo,
      comment: options.comment,
      // 明細行の世帯メンバー: 科目の既定メンバー > 行の世帯メンバー > 起票者(計画Issue #169・#180)
      resolveLineHouseholdMemberId: createLineHouseholdMemberResolver(accounts, bookkeeperHouseholdMemberId),
    })
  }

  return {
    listPending(): PendingRecurringTransactionProposal[] {
      return ruleRepository.findAll().flatMap((rule) => {
        const proposals = evaluatePendingForRule(rule)
        if (proposals.length === 0) return []
        return proposals.map((proposal, offset) => {
          // 仕訳に含めない金額0の行は、確認パネルにも出さない
          const defaultLines = defaultLinesOf(rule, offset).filter((l) => l.amount > 0)
          return {
            ...proposal,
            entryDate: adjustForWeekend(proposal.dueDate, rule.weekendAdjustment),
            defaultLines,
            defaultAmount: debitTotalOf(defaultLines),
          }
        })
      })
    },

    confirm(input: ConfirmRecurringTransactionProposalInput): JournalEntry {
      const rule = assertNextPendingDueDate(input.ruleId, input.dueDate)

      return journalEntryRepository.create(
        buildJournalEntryInput(rule, input.dueDate, {
          householdMemberId: input.householdMemberId,
          defaultLines: defaultLinesOf(rule),
          lines: input.lines,
          memo: input.memo,
          comment: input.comment,
        }),
      )
    },

    confirmMany(input: ConfirmManyRecurringTransactionProposalsInput): JournalEntry[] {
      const selectedByRule = new Map<number, string[]>()
      for (const { ruleId, dueDate } of input.items) {
        const dueDates = selectedByRule.get(ruleId) ?? []
        if (dueDates.includes(dueDate)) {
          throw new Error(`duplicate proposal selected: rule ${ruleId}, due date ${dueDate}`)
        }
        dueDates.push(dueDate)
        selectedByRule.set(ruleId, dueDates)
      }

      // 先に全件を検証し、仕訳の入力を組み立てる(1件でも不正なら、何も書き込まない)
      const inputs: CreateJournalEntryInput[] = []
      for (const [ruleId, dueDates] of selectedByRule) {
        const rule = findRule(ruleId)
        const pending = evaluatePendingForRule(rule).map((p) => p.dueDate)
        const selected = [...dueDates].sort()
        if (selected.some((dueDate, index) => dueDate !== pending[index])) {
          throw new Error(
            `selected due dates for recurring transaction rule ${rule.id} must be the oldest pending occurrences without gaps: pending ${JSON.stringify(pending)}, selected ${JSON.stringify(selected)}`,
          )
        }

        // 初期値は選択時点のもの。2件目以降を直前の確定額に追従させない
        selected.forEach((dueDate, offset) => {
          inputs.push(
            buildJournalEntryInput(rule, dueDate, {
              householdMemberId: input.householdMemberId,
              defaultLines: defaultLinesOf(rule, offset),
            }),
          )
        })
      }

      return journalEntryRepository.createMany(inputs)
    },

    skip(input: SkipRecurringTransactionProposalInput): void {
      const rule = assertNextPendingDueDate(input.ruleId, input.dueDate)
      ruleRepository.recordSkip(rule.id, input.dueDate)
    },
  }
}
