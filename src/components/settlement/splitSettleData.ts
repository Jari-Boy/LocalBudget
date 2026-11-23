import type { HistoryGroupApi } from '../../infrastructure/history/historyGroupRunner'
import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { ExpenseSplitSourceLink } from '../../domain/expense-splitting/listSplittableLineEntries'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilterContext } from '../../domain/journal/JournalEntryFilter'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import type { JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { JournalEntryLinkGroupRepository } from '../../domain/journal-link-group/JournalEntryLinkGroupRepository'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import type { JournalFilterOptions } from '../common/journal-filter/JournalFilterPanel'
import { SOURCE_TAGS } from '../common/journal-result/journalResultModel'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import type { MaybeAsync } from '../master/maybeAsync'

/** 割勘・精算画面が使うRepository。割勘タブ・精算タブの両方の書き込みを含む */
export interface SplitSettleRepositories {
  /** 割勘・精算(複数の書き込み)を操作履歴上1件にまとめる(計画Issue #202)。省略時はまとめない */
  history?: HistoryGroupApi
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll' | 'create' | 'update' | 'delete'>> &
    Partial<MaybeAsync<Pick<JournalEntryRepository, 'findExpenseSplitSourceLinks'>>>
  journalEntryLinkGroupRepository: MaybeAsync<
    Pick<JournalEntryLinkGroupRepository, 'findAllMemberships' | 'joinOrCreateGroups'>
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll' | 'create'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<
    Pick<
      SettlementBatchRepository,
      'findAll' | 'create' | 'update' | 'delete' | 'deactivate' | 'activate' | 'recordCloseEntries' | 'findCloseEntryIds'
    >
  >
}

export interface SplitSettleData {
  entries: JournalEntry[]
  accounts: Account[]
  accountGroups: AccountGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  members: HouseholdMember[]
  batches: SettlementBatch[]
  memberships: JournalEntryLinkGroupMembership[]
  /** 割勘対象行の記録(どの行が割勘済みか、計画Issue #271) */
  sourceLinks: ExpenseSplitSourceLink[]
  /** クローズ済みのバッチごとの、クローズ時に自動で作った振替仕訳のid(再オープンで削除する対象、計画Issue #249) */
  closeEntries: { batchId: number; entryIds: number[] }[]
}

export async function loadSplitSettleData(repos: SplitSettleRepositories): Promise<SplitSettleData> {
  const [
    entries,
    accounts,
    accountGroups,
    counterparties,
    counterpartyGroups,
    projects,
    projectGroups,
    members,
    batches,
    memberships,
    sourceLinks,
  ] = await Promise.all([
    repos.journalEntryRepository.findAll(),
    repos.accountRepository.findAll(),
    repos.accountGroupRepository.findAll(),
    repos.counterpartyRepository.findAll(),
    repos.counterpartyGroupRepository.findAll(),
    repos.projectRepository.findAll(),
    repos.projectGroupRepository.findAll(),
    repos.householdMemberRepository.findAll(),
    repos.settlementBatchRepository.findAll(),
    repos.journalEntryLinkGroupRepository.findAllMemberships(),
    repos.journalEntryRepository.findExpenseSplitSourceLinks === undefined
      ? []
      : repos.journalEntryRepository.findExpenseSplitSourceLinks(),
  ])
  const closeEntries = (
    await Promise.all(
      batches
        .filter((b) => !b.isActive)
        .map(async (b) => ({ batchId: b.id, entryIds: await repos.settlementBatchRepository.findCloseEntryIds(b.id) })),
    )
  ).filter((c) => c.entryIds.length > 0)
  return {
    entries,
    accounts,
    accountGroups,
    counterparties,
    counterpartyGroups,
    projects,
    projectGroups,
    members,
    batches,
    memberships,
    sourceLinks,
    closeEntries,
  }
}

const inactiveIds = (items: ReadonlyArray<{ id: number; isActive: boolean }>) =>
  new Set(items.filter((i) => !i.isActive).map((i) => i.id))

export interface SplitSettleDerived {
  filterContext: JournalEntryFilterContext
  filterOptions: JournalFilterOptions
  counterpartyCategories: TreeSelectCategory[]
  accountCategories: TreeSelectCategory[]
}

/** 絞り込みパネルと分担相手の選択ツリーに渡す、マスタから導いた値(JournalScreenと同じ組み立て) */
export function deriveSplitSettle(data: SplitSettleData): SplitSettleDerived {
  const accountCategories = buildTreeSelectCategories(
    buildAccountTree({ groups: data.accountGroups, accounts: data.accounts, memberNameById: new Map() }),
    inactiveIds(data.accounts),
  ).filter((c) => c.nodes.length > 0)
  const counterpartyCategories = buildTreeSelectCategories(
    buildCounterpartyTree({
      groups: data.counterpartyGroups,
      counterparties: data.counterparties,
      patternCountById: new Map(),
    }),
    inactiveIds(data.counterparties),
  )
  const projectCategories = buildTreeSelectCategories(
    buildProjectTree({ groups: data.projectGroups, projects: data.projects }),
    inactiveIds(data.projects),
  )
  return {
    filterContext: {
      accountGroups: data.accountGroups,
      counterparties: data.counterparties,
      counterpartyGroups: data.counterpartyGroups,
      projects: data.projects,
      projectGroups: data.projectGroups,
    },
    filterOptions: {
      accountCategories,
      counterpartyCategories,
      projectCategories,
      members: data.members.map((m) => ({ value: String(m.id), name: m.name })),
      batches: data.batches.map((b) => ({ value: String(b.id), name: b.name })),
      sourceTypes: Object.entries(SOURCE_TAGS).map(([value, tag]) => ({ value, name: tag.label })),
    },
    counterpartyCategories,
    accountCategories,
  }
}
