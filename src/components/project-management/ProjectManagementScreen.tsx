import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type {
  CreateProjectInput,
  Project,
  ProjectKind,
  UpdateProjectInput,
} from '../../domain/project/Project'
import { isSettlementBalanceZero } from '../../domain/project/isSettlementBalanceZero'
import {
  summarizeProjectAccountBalances,
  type ProjectAccountBalances,
} from '../../domain/project/summarizeProjectAccountBalances'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './ProjectManagementScreen.css'

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface ProjectCreator {
  create(input: CreateProjectInput): Project | Promise<Project>
}
interface ProjectUpdater {
  update(id: number, input: UpdateProjectInput): Project | Promise<Project>
}
interface ProjectDeleter {
  delete(id: number): void | Promise<void>
}
interface ProjectDeactivator {
  deactivate(id: number): Project | Promise<Project>
}

export interface ProjectManagementScreenProps {
  projectRepository: ProjectFinder & ProjectCreator & ProjectUpdater & ProjectDeleter & ProjectDeactivator
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
}

interface LoadedData {
  projects: Project[]
  entries: JournalEntry[]
  accounts: Account[]
  /** docs/domain/projects.md 1.3節の削除可否判定に使う、プロジェクトidごとの紐づく仕訳明細件数 */
  journalLineCountByProjectId: Map<number, number>
}

const BALANCE_CATEGORIES: {
  key: keyof ProjectAccountBalances
  titleKey: 'balanceAssetsTitle' | 'balanceLiabilitiesTitle' | 'balanceEquityTitle' | 'balanceRevenuesTitle' | 'balanceExpensesTitle'
}[] = [
  { key: 'assets', titleKey: 'balanceAssetsTitle' },
  { key: 'liabilities', titleKey: 'balanceLiabilitiesTitle' },
  { key: 'equity', titleKey: 'balanceEquityTitle' },
  { key: 'revenues', titleKey: 'balanceRevenuesTitle' },
  { key: 'expenses', titleKey: 'balanceExpensesTitle' },
]

/** nullは非表示、'create'は新規作成行、number(id)は該当プロジェクトの編集行を表す */
type FormMode = 'create' | number | null

/**
 * プロジェクト管理画面(計画Issue #36、計画Issue #127でテーブル形式+行内インライン編集に変更)。
 * 登録済みプロジェクトをテーブル(thead/tbody)として一覧表示し、新規作成(名称・kind)は表の
 * 最終行に追加される作成用の行から行う。既存プロジェクトの編集(名称のみ、kindは作成時のみ
 * 指定可能)は行の「編集」ボタンでその行だけ入力欄に切り替わるインライン編集方式とし、
 * 「保存する」/「キャンセル」で確定・破棄する(docs/domain/projects.md 1.3節・2章)。
 * プロジェクトごとに専用の<tbody>でグルーピングし、残高内訳パネル・非アクティブ化提案は
 * 同じ<tbody>内の追加行として行の下に展開する。物理削除は紐づく仕訳明細が0件の場合のみ
 * 許可し、1件以上の場合は非アクティブ化のみ選択できる(削除操作自体はDDLトリガー
 * prevent_delete_project_with_journal_linesでも強制されるが、UI側で事前に判定し不可能な
 * 操作を選択肢に出さない)。
 */
export function ProjectManagementScreen({
  projectRepository,
  accountRepository,
  journalEntryRepository,
  onBack,
}: ProjectManagementScreenProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [kindInput, setKindInput] = useState<ProjectKind>('event')
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** 「内訳を表示」で展開したプロジェクト別のPL/BS科目残高内訳パネル */
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set())

  const load = () => {
    void Promise.all([
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
    ]).then(([projects, accounts, entries]) => {
      const journalLineCountByProjectId = new Map<number, number>()
      for (const entry of entries) {
        for (const line of entry.lines) {
          if (line.projectId === null) continue
          journalLineCountByProjectId.set(
            line.projectId,
            (journalLineCountByProjectId.get(line.projectId) ?? 0) + 1,
          )
        }
      }
      setData({ projects, entries, accounts, journalLineCountByProjectId })
    })
  }

  useEffect(load, [projectRepository, accountRepository, journalEntryRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openCreateForm = () => {
    setNameInput('')
    setKindInput('event')
    setError(null)
    setFormMode('create')
  }

  const openEditForm = (project: Project) => {
    setNameInput(project.name)
    setError(null)
    setFormMode(project.id)
  }

  const closeForm = () => {
    setFormMode(null)
    setError(null)
  }

  const submitForm = () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    const request =
      formMode === 'create'
        ? Promise.resolve(projectRepository.create({ name: nameInput, kind: kindInput }))
        : Promise.resolve(projectRepository.update(formMode as number, { name: nameInput }))

    void request
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteProject = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(projectRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateProject = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(projectRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const toggleDetail = (projectId: number) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  return (
    <div className="project-management-screen">
      <h2>{t('projectListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.projects.length === 0 && formMode !== 'create' ? (
        <p>{t('projectListEmpty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{t('nameLabel')}</th>
              <th scope="col">{t('kindLabel')}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          {data.projects.map((project) => {
            const journalLineCount = data.journalLineCountByProjectId.get(project.id) ?? 0
            const detailExpanded = expandedProjectIds.has(project.id)
            const proposeDeactivation =
              project.isActive && isSettlementBalanceZero(project, data.entries, data.accounts)
            const isEditing = formMode === project.id
            const kindLabel = t(project.kind === 'settlement' ? 'kindSettlement' : 'kindEvent')

            return (
              <tbody key={project.id}>
                {isEditing ? (
                  <tr>
                    <td>
                      <input
                        aria-label={t('nameLabel')}
                        type="text"
                        value={nameInput}
                        onChange={(event) => setNameInput(event.target.value)}
                      />
                    </td>
                    <td>{kindLabel}</td>
                    <td className="project-list-actions">
                      <button
                        type="button"
                        onClick={submitForm}
                        disabled={nameInput.trim() === '' || isSubmitting}
                      >
                        {t('saveSubmit')}
                      </button>
                      <button type="button" onClick={closeForm} disabled={isSubmitting}>
                        {t('cancel')}
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td>
                      {project.name}
                      {!project.isActive && (
                        <span className="project-list-inactive">{t('inactiveLabel')}</span>
                      )}
                    </td>
                    <td>{kindLabel}</td>
                    <td className="project-list-actions">
                      <button
                        type="button"
                        onClick={() => toggleDetail(project.id)}
                        aria-expanded={detailExpanded}
                      >
                        {detailExpanded ? t('detailToggleCollapse') : t('detailToggle')}
                      </button>
                      <button type="button" onClick={() => openEditForm(project)} disabled={isSubmitting}>
                        {t('editButton')}
                      </button>
                      {journalLineCount === 0 && (
                        <button type="button" onClick={() => deleteProject(project.id)} disabled={isSubmitting}>
                          {t('deleteButton')}
                        </button>
                      )}
                      {project.isActive && (
                        <button
                          type="button"
                          onClick={() => deactivateProject(project.id)}
                          disabled={isSubmitting}
                        >
                          {t('deactivateButton')}
                        </button>
                      )}
                    </td>
                  </tr>
                )}

                {proposeDeactivation && (
                  <tr className="project-panel-row">
                    <td colSpan={3}>
                      <div className="project-deactivation-proposal" role="status">
                        <p>{t('deactivationProposalMessage')}</p>
                        <button
                          type="button"
                          onClick={() => deactivateProject(project.id)}
                          disabled={isSubmitting}
                        >
                          {t('deactivationProposalSubmit')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {detailExpanded && (
                  <tr className="project-panel-row">
                    <td colSpan={3}>
                      <div className="project-balance-panel">
                        {(() => {
                          const balances = summarizeProjectAccountBalances(
                            data.entries,
                            data.accounts,
                            project.id,
                          )
                          const hasAnyBalance = BALANCE_CATEGORIES.some(
                            ({ key }) => balances[key].length > 0,
                          )
                          if (!hasAnyBalance) {
                            return <p>{t('balanceEmpty')}</p>
                          }
                          return (
                            <>
                              {BALANCE_CATEGORIES.filter(({ key }) => balances[key].length > 0).map(
                                ({ key, titleKey }) => (
                                  <div key={key} className="project-balance-category">
                                    <h4>{t(titleKey)}</h4>
                                    <ul className="project-balance-list">
                                      {balances[key].map((accountAmount) => (
                                        <li key={accountAmount.accountId}>
                                          <span>{accountAmount.accountName}</span>
                                          <span>{formatCurrency(accountAmount.amount, 'JPY')}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ),
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            )
          })}

          {formMode === 'create' && (
            <tbody>
              <tr>
                <td>
                  <input
                    aria-label={t('nameLabel')}
                    type="text"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                  />
                </td>
                <td>
                  <select
                    aria-label={t('kindLabel')}
                    value={kindInput}
                    onChange={(event) => setKindInput(event.target.value as ProjectKind)}
                  >
                    <option value="event">{t('kindEvent')}</option>
                    <option value="settlement">{t('kindSettlement')}</option>
                  </select>
                </td>
                <td className="project-list-actions">
                  <button
                    type="button"
                    onClick={submitForm}
                    disabled={nameInput.trim() === '' || isSubmitting}
                  >
                    {t('createSubmit')}
                  </button>
                  <button type="button" onClick={closeForm} disabled={isSubmitting}>
                    {t('cancel')}
                  </button>
                </td>
              </tr>
            </tbody>
          )}
        </table>
      )}

      {formMode === null && (
        <button type="button" onClick={openCreateForm} disabled={isSubmitting}>
          {t('addButton')}
        </button>
      )}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
