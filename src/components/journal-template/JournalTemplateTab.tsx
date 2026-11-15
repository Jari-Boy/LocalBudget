import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import type { JournalTemplateRepository } from '../../domain/journal-template/JournalTemplateRepository'
import type { JournalTemplateGroup } from '../../domain/journal-template-group/JournalTemplateGroup'
import type { JournalTemplateGroupRepository } from '../../domain/journal-template-group/JournalTemplateGroupRepository'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { GroupedMasterTab, type GroupedMasterActions } from '../master/GroupedMasterTab'
import {
  buildAccountTree,
  buildCounterpartyTree,
  buildJournalTemplateTree,
  buildProjectTree,
  parseNodeId,
} from '../master/masterTreeNodes'
import type { MaybeAsync } from '../master/maybeAsync'
import { uniqueName } from '../master/uniqueName'
import type { JournalEditorMaster } from '../journal-entry/JournalEntryEditor'
import { JournalTemplateExtra } from './JournalTemplateExtra'

export interface JournalTemplateTabProps {
  journalTemplateRepository: MaybeAsync<
    Pick<JournalTemplateRepository, 'findAll' | 'create' | 'update' | 'delete' | 'deactivate' | 'activate'>
  >
  journalTemplateGroupRepository: MaybeAsync<
    Pick<JournalTemplateGroupRepository, 'findAll' | 'create' | 'update' | 'delete'>
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  /** 行の精算バッチの選択肢。省略時は選択肢なし */
  settlementBatchRepository?: MaybeAsync<Pick<SettlementBatchRepository, 'findAll'>>
}

interface LoadedData {
  templates: JournalTemplate[]
  groups: JournalTemplateGroup[]
  accounts: Account[]
  accountGroups: AccountGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  members: HouseholdMember[]
  batches: SettlementBatch[]
}

const LEAF_LABEL = 'テンプレート'
const NEW_TEMPLATE_NAME = '新しいテンプレート'

/**
 * 仕訳画面の「テンプレート」タブ(計画Issue #201)。グループとテンプレートをツリー表で表示し(内容・金額・状態の列)、
 * 右パネルで名称・所属グループ・並び順(共通の画面はGroupedMasterTab)と、摘要・起票者・明細行
 * (JournalTemplateExtra。行の編集部品は定期仕訳・仕訳の起票と共通で、金額は空欄にできる)を編集する。
 * 「保存」は名称と摘要・起票者・明細行をまとめて保存する。テンプレートは仕訳から参照されないため、
 * いつでも削除できる(2回押し)。並び順は「テンプレートから起票」のダイアログの並びにそのまま使われる。
 * 「テンプレートを追加」は、費用の科目と資産の科目で金額が空欄の2行を持つテンプレートを作り、編集パネルを開く。
 */
export function JournalTemplateTab(props: JournalTemplateTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const {
    journalTemplateRepository: templateRepo,
    journalTemplateGroupRepository: groupRepo,
    accountRepository,
    accountGroupRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
  } = props

  const load = useCallback(async () => {
    const [templates, groups, accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members, batches] =
      await Promise.all([
        templateRepo.findAll(),
        groupRepo.findAll(),
        accountRepository.findAll(),
        accountGroupRepository.findAll(),
        counterpartyRepository.findAll(),
        counterpartyGroupRepository.findAll(),
        projectRepository.findAll(),
        projectGroupRepository.findAll(),
        householdMemberRepository.findAll(),
        settlementBatchRepository === undefined ? [] : settlementBatchRepository.findAll(),
      ])
    setData({
      templates,
      groups,
      accounts,
      accountGroups,
      counterparties,
      counterpartyGroups,
      projects,
      projectGroups,
      members,
      batches,
    })
  }, [
    templateRepo,
    groupRepo,
    accountRepository,
    accountGroupRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(
    () =>
      data
        ? buildJournalTemplateTree({
            groups: data.groups,
            templates: data.templates,
            accountNameById: new Map(data.accounts.map((a) => [a.id, a.name])),
          })
        : null,
    [data],
  )

  /** 明細行の編集部品に渡すマスタ。無効な項目は、いま選ばれている場合だけ選択肢に残る */
  const master = useMemo((): JournalEditorMaster | null => {
    if (!data) return null
    const accountTree = buildAccountTree({ groups: data.accountGroups, accounts: data.accounts, memberNameById: new Map() })
    const counterpartyTree = buildCounterpartyTree({
      groups: data.counterpartyGroups,
      counterparties: data.counterparties,
      accountNameById: new Map(),
      patternCountById: new Map(),
    })
    const projectTree = buildProjectTree({ groups: data.projectGroups, projects: data.projects })
    const inactive = (items: ReadonlyArray<{ id: number; isActive: boolean }>) =>
      new Set(items.filter((i) => !i.isActive).map((i) => i.id))
    return {
      accounts: data.accounts,
      accountCategories: buildTreeSelectCategories(accountTree, inactive(data.accounts)).filter((c) => c.key !== 'equity'),
      counterpartyCategories: buildTreeSelectCategories(counterpartyTree, inactive(data.counterparties)),
      projectCategories: buildTreeSelectCategories(projectTree, inactive(data.projects)),
      members: data.members,
      batches: data.batches,
    }
  }, [data])

  if (data === null || tree === null || master === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const actions: GroupedMasterActions = {
    applyUpdate: async (update) => {
      const { kind, id } = parseNodeId(update.id)
      const parentId = update.parentId === null ? null : parseNodeId(update.parentId).id
      if (kind === 'group') {
        await groupRepo.update(id, { parentGroupId: parentId, sortOrder: update.sortOrder })
      } else {
        await templateRepo.update(id, { groupId: parentId, sortOrder: update.sortOrder })
      }
    },
    createGroup: async (parentGroupId) =>
      (
        await groupRepo.create({
          name: uniqueName(t('accountTab.newGroupName'), data.groups.map((g) => g.name)),
          parentGroupId,
        })
      ).id,
    createLeaf: async (groupId) => {
      const [debit, credit] = pickDefaultAccounts(data.accounts)
      if (debit === undefined || credit === undefined) {
        throw new Error('テンプレートの行にする科目が2つ以上必要です')
      }
      return (
        await templateRepo.create({
          name: uniqueName(NEW_TEMPLATE_NAME, data.templates.map((x) => x.name)),
          groupId,
          lines: [
            { side: 'debit', accountId: debit.id, amount: null },
            { side: 'credit', accountId: credit.id, amount: null },
          ],
        })
      ).id
    },
    rename: async (nodeId, name) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await groupRepo.update(id, { name })
      else await templateRepo.update(id, { name })
    },
    setLeafActive: async (id, active) => {
      if (active) await templateRepo.activate(id)
      else await templateRepo.deactivate(id)
    },
    remove: async (nodeId) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await groupRepo.delete(id)
      else await templateRepo.delete(id)
    },
  }

  return (
    <GroupedMasterTab
      tree={tree}
      columns={['内容', '金額', '状態']}
      leafLabel={LEAF_LABEL}
      // 左の一覧は仕訳一覧と同じカード型、右パネルは仕訳の詳細と同じ幅の比(2:3)にする
      renderCard={(node) => ({
        sub: node.cells[0],
        amount: node.cells[1],
        tag: node.cells[2] === '有効' ? undefined : node.cells[2],
      })}
      splitClassName="master-split--rule"
      actions={actions}
      isLeafActive={(id) => data.templates.find((x) => x.id === id)?.isActive ?? true}
      // テンプレートは仕訳から参照されないため、いつでも削除できる
      leafBlockedText={() => ''}
      onChanged={load}
      renderLeafExtra={(id, { setFormState }) => {
        const template = data.templates.find((x) => x.id === id)
        if (template === undefined) return null
        return (
          <JournalTemplateExtra
            template={template}
            master={master}
            setFormState={setFormState}
            save={(input) => Promise.resolve(templateRepo.update(id, input)).then(() => undefined)}
          />
        )
      }}
    />
  )
}

/**
 * 新しいテンプレートの既定の行に使う科目。借方は有効な費用の科目、貸方は有効な資産の科目を優先し、
 * 無ければ有効な別の科目で補う(資本の科目は使わない)。2つ見つからなければundefinedを含む
 */
function pickDefaultAccounts(accounts: readonly Account[]): [Account | undefined, Account | undefined] {
  const usable = accounts.filter((a) => a.isActive && a.category !== 'equity')
  const debit = usable.find((a) => a.category === 'expense') ?? usable[0]
  const credit = usable.find((a) => a.category === 'asset' && a.id !== debit?.id) ?? usable.find((a) => a.id !== debit?.id)
  return [debit, credit]
}
