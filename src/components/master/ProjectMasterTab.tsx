import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listDeletionBlocks, summarizeMasterUsage } from '../../domain/master/summarizeMasterUsage'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { describeDeletionBlocks } from './describeDeletionBlocks'
import { GroupedMasterTab, type GroupedMasterActions } from './GroupedMasterTab'
import { buildProjectTree, parseNodeId } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import { uniqueName } from './uniqueName'

export interface ProjectMasterTabProps {
  projectRepository: MaybeAsync<
    Pick<ProjectRepository, 'findAll' | 'create' | 'update' | 'delete' | 'deactivate' | 'activate'>
  >
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll' | 'create' | 'update' | 'delete'>>
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll'>>
}

interface LoadedData {
  projects: Project[]
  groups: ProjectGroup[]
  entries: JournalEntry[]
  rules: RecurringTransactionRule[]
}

const LEAF_LABEL = 'プロジェクト'

/**
 * マスタ画面の「プロジェクト」タブ(計画Issue #154)。グループとプロジェクトをツリー表で表示し、
 * 右パネルで編集する(共通の画面はGroupedMasterTab)。仕訳または定期取引ルールで使用中の
 * プロジェクトは削除できず、理由を表示する。
 */
export function ProjectMasterTab({
  projectRepository,
  projectGroupRepository,
  journalEntryRepository,
  recurringTransactionRuleRepository,
}: ProjectMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)

  const load = useCallback(async () => {
    const [projects, groups, entries, rules] = await Promise.all([
      projectRepository.findAll(),
      projectGroupRepository.findAll(),
      journalEntryRepository.findAll(),
      recurringTransactionRuleRepository.findAll(),
    ])
    setData({ projects, groups, entries, rules })
  }, [projectRepository, projectGroupRepository, journalEntryRepository, recurringTransactionRuleRepository])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(() => (data ? buildProjectTree({ groups: data.groups, projects: data.projects }) : null), [data])
  const usage = useMemo(
    () =>
      data
        ? summarizeMasterUsage({
            entries: data.entries,
            budgets: [],
            rules: data.rules,
            settlementBatches: [],
            accounts: [],
          })
        : null,
    [data],
  )

  if (data === null || tree === null || usage === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const actions: GroupedMasterActions = {
    applyUpdate: async (update) => {
      const { kind, id } = parseNodeId(update.id)
      const parentId = update.parentId === null ? null : parseNodeId(update.parentId).id
      if (kind === 'group') {
        await projectGroupRepository.update(id, { parentGroupId: parentId, sortOrder: update.sortOrder })
      } else {
        await projectRepository.update(id, { projectGroupId: parentId, sortOrder: update.sortOrder })
      }
    },
    createGroup: async (parentGroupId) =>
      (
        await projectGroupRepository.create({
          name: uniqueName(t('accountTab.newGroupName'), data.groups.map((g) => g.name)),
          parentGroupId,
        })
      ).id,
    createLeaf: async (projectGroupId) =>
      (
        await projectRepository.create({
          name: uniqueName(t('groupedTab.newLeafName', { leaf: LEAF_LABEL }), data.projects.map((p) => p.name)),
          projectGroupId,
        })
      ).id,
    rename: async (nodeId, name) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await projectGroupRepository.update(id, { name })
      else await projectRepository.update(id, { name })
    },
    setLeafActive: async (id, active) => {
      if (active) await projectRepository.activate(id)
      else await projectRepository.deactivate(id)
    },
    remove: async (nodeId) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await projectGroupRepository.delete(id)
      else await projectRepository.delete(id)
    },
  }

  return (
    <GroupedMasterTab
      tree={tree}
      columns={['状態']}
      leafLabel={LEAF_LABEL}
      actions={actions}
      isLeafActive={(id) => data.projects.find((p) => p.id === id)?.isActive ?? true}
      leafBlockedText={(id) => describeDeletionBlocks(listDeletionBlocks('project', usage.get('project', id)), t)}
      onChanged={load}
    />
  )
}
