import type { Database } from 'sql.js'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from '../../domain/expense-splitting/buildHouseholdMemberExpenseSplittingJournalEntryInput'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from './SqlJsSettlementBatchRepository'
import { seedAdvanceAccounts } from './seedAdvanceAccounts'
import {
  DEV_SAMPLE_ACCOUNTS,
  DEV_SAMPLE_COUNTERPARTIES,
  DEV_SAMPLE_HOUSEHOLD_MEMBERS,
  DEV_SAMPLE_JOURNAL_ENTRIES,
  DEV_SAMPLE_PROJECTS,
  DEV_SAMPLE_SETTLEMENT_BATCHES,
  DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES,
  DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES,
  DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES,
} from './devSampleData'

/**
 * journal_entriesが1件も存在しない場合に、少数の口座(DEV_SAMPLE_ACCOUNTS: 現金・普通預金・
 * クレジットカード)・取引先(DEV_SAMPLE_COUNTERPARTIES)・プロジェクト(DEV_SAMPLE_PROJECTS)と
 * 直近1ヶ月分の数件のダミー仕訳(DEV_SAMPLE_JOURNAL_ENTRIES、取引先・プロジェクトの一部PL行への
 * 紐付けを含む)を自動投入する(開発環境限定、計画Issue #101・#107)。npm run dev起動直後から
 * 一覧表示・集計・グラフ等のUI動作確認がすぐにできる状態を作るためのものであり、本番ビルドには
 * 含まれない(呼び出し元のseedDevSampleDataIfDev.ts参照)。
 * 冪等性の判定基準はjournal_entriesの0件判定のみ(seedDefaultHouseholdMemberと同じ考え方)。
 * 取引先・プロジェクトを独立した冪等シードに分離しない(ユーザーが取引先だけ削除した場合に
 * 次回起動時に無関係な取引先だけ再投入される、といった既存仕訳と紐づかない孤立データが
 * 生まれるのを避けるため。計画Issue #107の制約参照)。
 * 相手科目(食費・交通費・給与収入)はseedDefaultAccounts(計画Issue #96)が投入する標準科目に
 * 依存するため、db.worker.tsのmain()内ではseedDefaultAccounts(db)より後に呼び出す必要がある。
 * 投入する口座はいずれもis_reconcilable = falseで作成する。UI動作確認用の簡略化されたダミー
 * データであり、外部明細CSVとの突合(is_reconcilable = trueに伴うsource_type制限、
 * docs/domain/reconciliation.md 1.2)を再現する必要がないため、手入力(source_type = 'manual'、
 * 既定値)のままどの口座にも直接記帳できるようにしている。
 *
 * 計画Issue #139で、精算画面(SettlementScreen)の新しい操作モデルを手動確認できるよう、
 * 世帯メンバー(DEV_SAMPLE_HOUSEHOLD_MEMBERS)・精算バッチ(DEV_SAMPLE_SETTLEMENT_BATCHES)・
 * 割当済みの割勘/後払い仕訳(DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES/PAYABLE_ENTRIES)・未割当の
 * 返済候補仕訳(DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES)を追加投入する(既存の
 * DEV_SAMPLE_JOURNAL_ENTRIES等の並び・件数は変更せず追加のみ、devSampleData.ts参照)。
 * 立替金(資産/負債)科目はseedAdvanceAccountsが投入するis_system_managed科目を自動解決して使うため、
 * 本関数の先頭で自ら呼び出す(db.worker.tsの呼び出し順に依存せず自己完結させる)。
 */
export function seedDevSampleData(db: Database, today: Date = new Date()): void {
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  if (journalEntryRepository.findAll().length > 0) return

  seedAdvanceAccounts(db)

  const accountRepository = new SqlJsAccountRepository(db)
  for (const seed of DEV_SAMPLE_ACCOUNTS) {
    accountRepository.create({ category: seed.category, name: seed.name, isReconcilable: false })
  }

  const counterpartyRepository = new SqlJsCounterpartyRepository(db)
  for (const seed of DEV_SAMPLE_COUNTERPARTIES) {
    counterpartyRepository.create({ name: seed.name })
  }

  const projectRepository = new SqlJsProjectRepository(db)
  for (const seed of DEV_SAMPLE_PROJECTS) {
    projectRepository.create({ name: seed.name })
  }

  const householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  for (const seed of DEV_SAMPLE_HOUSEHOLD_MEMBERS) {
    householdMemberRepository.create({ name: seed.name })
  }

  const accountIdByName = new Map(
    accountRepository.findAll().map((account) => [account.name, account.id]),
  )
  const counterpartyIdByName = new Map(
    counterpartyRepository.findAll().map((counterparty) => [counterparty.name, counterparty.id]),
  )
  const projectIdByName = new Map(
    projectRepository.findAll().map((project) => [project.name, project.id]),
  )
  const householdMemberIdByName = new Map(
    householdMemberRepository.findAll().map((member) => [member.name, member.id]),
  )
  const householdMemberId = householdMemberRepository.findAll()[0]!.id

  for (const entry of DEV_SAMPLE_JOURNAL_ENTRIES) {
    const projectId = entry.projectName ? projectIdByName.get(entry.projectName)! : null
    journalEntryRepository.create({
      entryDate: formatDateDaysAgo(today, entry.daysAgo),
      memo: entry.memo,
      householdMemberId,
      lines: [
        {
          accountId: accountIdByName.get(entry.debitAccountName)!,
          side: 'debit',
          amount: entry.amount,
          counterpartyId: entry.debitCounterpartyName
            ? counterpartyIdByName.get(entry.debitCounterpartyName)!
            : null,
          projectId,
        },
        {
          accountId: accountIdByName.get(entry.creditAccountName)!,
          side: 'credit',
          amount: entry.amount,
          counterpartyId: entry.creditCounterpartyName
            ? counterpartyIdByName.get(entry.creditCounterpartyName)!
            : null,
          projectId,
        },
      ],
    })
  }

  const settlementBatchRepository = new SqlJsSettlementBatchRepository(db)
  for (const seed of DEV_SAMPLE_SETTLEMENT_BATCHES) {
    settlementBatchRepository.create({
      name: seed.name,
      type: seed.type,
      counterpartyId: seed.counterpartyName ? counterpartyIdByName.get(seed.counterpartyName)! : null,
    })
  }
  const settlementBatchIdByName = new Map(
    settlementBatchRepository.findAll().map((batch) => [batch.name, batch.id]),
  )

  const advanceAssetAccountId = accountRepository
    .findAll()
    .find((account) => account.category === 'asset' && account.isSystemManaged)!.id
  const advanceLiabilityAccountId = accountRepository
    .findAll()
    .find((account) => account.category === 'liability' && account.isSystemManaged)!.id

  for (const seed of DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES) {
    journalEntryRepository.create(
      buildHouseholdMemberExpenseSplittingJournalEntryInput({
        expenseAccountId: accountIdByName.get(seed.expenseAccountName)!,
        advanceAssetAccountId,
        advanceLiabilityAccountId,
        fromMemberId: householdMemberIdByName.get(seed.fromMemberName)!,
        toMemberId: householdMemberIdByName.get(seed.toMemberName)!,
        settlementBatchId: settlementBatchIdByName.get(seed.batchName)!,
        amount: seed.amount,
        entryDate: formatDateDaysAgo(today, seed.daysAgo),
        memo: seed.memo,
      }),
    )
  }

  for (const seed of DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES) {
    const payerMemberId = householdMemberIdByName.get(seed.payerMemberName)!
    journalEntryRepository.create({
      entryDate: formatDateDaysAgo(today, seed.daysAgo),
      memo: seed.memo,
      householdMemberId: payerMemberId,
      lines: [
        { accountId: accountIdByName.get(seed.expenseAccountName)!, side: 'debit', amount: seed.amount },
        {
          accountId: advanceLiabilityAccountId,
          side: 'credit',
          amount: seed.amount,
          householdMemberId: payerMemberId,
          settlementBatchId: settlementBatchIdByName.get(seed.batchName)!,
        },
      ],
    })
  }

  for (const seed of DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES) {
    const memberId = seed.memberName ? householdMemberIdByName.get(seed.memberName)! : null
    journalEntryRepository.create({
      entryDate: formatDateDaysAgo(today, seed.daysAgo),
      memo: seed.memo,
      householdMemberId: memberId ?? householdMemberId,
      lines: [
        { accountId: advanceLiabilityAccountId, side: 'debit', amount: seed.amount, householdMemberId: memberId },
        { accountId: accountIdByName.get(seed.cashAccountName)!, side: 'credit', amount: seed.amount },
      ],
    })
  }
}

function formatDateDaysAgo(today: Date, daysAgo: number): string {
  const date = new Date(today)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}
