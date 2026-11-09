import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Budget, CreateBudgetInput, UpdateBudgetInput } from '../../domain/budget/Budget'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { Project } from '../../domain/project/Project'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { MaybeAsync } from '../master/maybeAsync'

/**
 * 分析画面(計画Issue #155)が使うRepositoryの、読み取り(と予算の更新)に必要な部分。
 * sql.jsを直接呼ぶ同期の実装と、Web Worker越しの非同期の実装のどちらも受け取れる(MaybeAsync)。
 */
export interface AnalysisRepositories {
  accountRepository: MaybeAsync<{ findAll(): Account[] }>
  accountGroupRepository: MaybeAsync<{ findAll(): AccountGroup[] }>
  journalEntryRepository: MaybeAsync<{ findAll(): JournalEntry[] }>
  householdMemberRepository: MaybeAsync<{ findAll(): HouseholdMember[] }>
  projectRepository: MaybeAsync<{ findAll(): Project[] }>
  projectGroupRepository: MaybeAsync<{ findAll(): ProjectGroup[] }>
  counterpartyRepository: MaybeAsync<{ findAll(): Counterparty[] }>
  counterpartyGroupRepository: MaybeAsync<{ findAll(): CounterpartyGroup[] }>
  budgetRepository: MaybeAsync<{
    findAll(): Budget[]
    create(input: CreateBudgetInput): Budget
    update(id: number, input: UpdateBudgetInput): Budget
    delete(id: number): void
  }>
}

export interface AnalysisData {
  accounts: Account[]
  accountGroups: AccountGroup[]
  entries: JournalEntry[]
  members: HouseholdMember[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  budgets: Budget[]
}

export async function loadAnalysisData(repositories: AnalysisRepositories): Promise<AnalysisData> {
  const [accounts, accountGroups, entries, members, projects, projectGroups, counterparties, counterpartyGroups, budgets] =
    await Promise.all([
      repositories.accountRepository.findAll(),
      repositories.accountGroupRepository.findAll(),
      repositories.journalEntryRepository.findAll(),
      repositories.householdMemberRepository.findAll(),
      repositories.projectRepository.findAll(),
      repositories.projectGroupRepository.findAll(),
      repositories.counterpartyRepository.findAll(),
      repositories.counterpartyGroupRepository.findAll(),
      repositories.budgetRepository.findAll(),
    ])
  return { accounts, accountGroups, entries, members, projects, projectGroups, counterparties, counterpartyGroups, budgets }
}
