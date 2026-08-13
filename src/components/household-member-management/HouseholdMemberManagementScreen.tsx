import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type {
  CreateHouseholdMemberInput,
  HouseholdMember,
  UpdateHouseholdMemberInput,
} from '../../domain/household-member/HouseholdMember'
import './HouseholdMemberManagementScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface HouseholdMemberCreator {
  create(input: CreateHouseholdMemberInput): HouseholdMember | Promise<HouseholdMember>
}
interface HouseholdMemberUpdater {
  update(id: number, input: UpdateHouseholdMemberInput): HouseholdMember | Promise<HouseholdMember>
}
interface HouseholdMemberDeleter {
  delete(id: number): void | Promise<void>
}
interface HouseholdMemberDeactivator {
  deactivate(id: number): HouseholdMember | Promise<HouseholdMember>
}
interface GroupMemberAdder {
  addGroupMember(groupId: number, memberId: number): void | Promise<void>
}
interface GroupMemberRemover {
  removeGroupMember(groupId: number, memberId: number): void | Promise<void>
}
interface GroupMemberFinder {
  findGroupMembers(groupId: number): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface HouseholdMemberManagementScreenProps {
  householdMemberRepository: HouseholdMemberFinder &
    HouseholdMemberCreator &
    HouseholdMemberUpdater &
    HouseholdMemberDeleter &
    HouseholdMemberDeactivator &
    GroupMemberAdder &
    GroupMemberRemover &
    GroupMemberFinder
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  onBack: () => void
}

interface LoadedData {
  members: HouseholdMember[]
  /** docs/domain/household-members.md 1.3節の削除可否判定に使う、メンバーidごとに直接紐づく口座件数 */
  accountCountByMemberId: Map<number, number>
  /** 同節の削除可否判定に使う、メンバーidごとに直接紐づく仕訳明細件数 */
  journalLineCountByMemberId: Map<number, number>
  /** グループidごとの所属メンバー一覧(1.5節) */
  groupMembersByGroupId: Map<number, HouseholdMember[]>
}

/** nullは非表示、'create'は新規作成フォーム、number(id)は該当メンバーの編集フォームを表す */
type FormMode = 'create' | number | null

/**
 * 世帯メンバー管理画面(計画Issue #37)。登録済みメンバー(個人・グループ)の一覧表示・
 * 新規作成・編集(名称)・削除/非アクティブ化・グループの所属メンバー管理を、単一画面+
 * インラインフォームで提供する(docs/domain/household-members.md 1.3・1.5節)。
 *
 * グループのネスト不可・作成後のisGroup変更不可という制約(同1.5節)はドメイン層ではなく
 * DDLトリガー側で強制されている(HouseholdMemberRepositoryのJSDoc参照)。本画面では
 * これらを選択肢から機械的に排除せず、制約違反時にRepository層が投げる例外を捕捉して
 * エラー表示する(計画Issue #37の合意方針)。
 */
export function HouseholdMemberManagementScreen({
  householdMemberRepository,
  accountRepository,
  journalEntryRepository,
  onBack,
}: HouseholdMemberManagementScreenProps) {
  const { t } = useTranslation('householdMember')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [isGroupInput, setIsGroupInput] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化・グループメンバー追加/除去のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set())
  const [groupMemberInputByGroupId, setGroupMemberInputByGroupId] = useState<Map<number, string>>(new Map())

  const load = () => {
    void Promise.all([
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
    ]).then(async ([members, accounts, entries]) => {
      const accountCountByMemberId = new Map<number, number>()
      for (const account of accounts) {
        if (account.householdMemberId === null) continue
        accountCountByMemberId.set(
          account.householdMemberId,
          (accountCountByMemberId.get(account.householdMemberId) ?? 0) + 1,
        )
      }
      const journalLineCountByMemberId = new Map<number, number>()
      for (const entry of entries) {
        for (const line of entry.lines) {
          if (line.householdMemberId === null) continue
          journalLineCountByMemberId.set(
            line.householdMemberId,
            (journalLineCountByMemberId.get(line.householdMemberId) ?? 0) + 1,
          )
        }
      }
      const groups = members.filter((member) => member.isGroup)
      const groupMemberEntries = await Promise.all(
        groups.map(
          async (group) =>
            [group.id, await Promise.resolve(householdMemberRepository.findGroupMembers(group.id))] as const,
        ),
      )
      setData({
        members,
        accountCountByMemberId,
        journalLineCountByMemberId,
        groupMembersByGroupId: new Map(groupMemberEntries),
      })
    })
  }

  useEffect(load, [householdMemberRepository, accountRepository, journalEntryRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openCreateForm = () => {
    setNameInput('')
    setIsGroupInput(false)
    setError(null)
    setFormMode('create')
  }

  const openEditForm = (member: HouseholdMember) => {
    setNameInput(member.name)
    setIsGroupInput(member.isGroup)
    setError(null)
    setFormMode(member.id)
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
        ? Promise.resolve().then(() =>
            householdMemberRepository.create({ name: nameInput, isGroup: isGroupInput }),
          )
        : Promise.resolve().then(() =>
            householdMemberRepository.update(formMode as number, {
              name: nameInput,
              isGroup: isGroupInput,
            }),
          )

    void request
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteMember = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => householdMemberRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateMember = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => householdMemberRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const toggleGroupMembers = (groupId: number) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const setGroupMemberInput = (groupId: number, value: string) => {
    setGroupMemberInputByGroupId((prev) => {
      const next = new Map(prev)
      next.set(groupId, value)
      return next
    })
  }

  const addMemberToGroup = (groupId: number) => {
    if (isSubmitting) return
    const value = groupMemberInputByGroupId.get(groupId) ?? ''
    if (value === '') return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => householdMemberRepository.addGroupMember(groupId, Number(value)))
      .then(() => {
        setGroupMemberInput(groupId, '')
        load()
      })
      .catch(() => setError(t('groupMemberAddError')))
      .finally(() => setIsSubmitting(false))
  }

  const removeMemberFromGroup = (groupId: number, memberId: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => householdMemberRepository.removeGroupMember(groupId, memberId))
      .then(load)
      .catch(() => setError(t('groupMemberRemoveError')))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="household-member-management-screen">
      <h2>{t('householdMemberListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.members.length === 0 ? (
        <p>{t('householdMemberListEmpty')}</p>
      ) : (
        <ul>
          {data.members.map((member) => {
            const referenceCount =
              (data.accountCountByMemberId.get(member.id) ?? 0) +
              (data.journalLineCountByMemberId.get(member.id) ?? 0)
            const groupMembers = data.groupMembersByGroupId.get(member.id) ?? []
            const groupMembersExpanded = expandedGroupIds.has(member.id)
            const groupMemberIds = new Set(groupMembers.map((groupMember) => groupMember.id))
            const availableCandidates = data.members.filter(
              (candidate) => candidate.id !== member.id && !groupMemberIds.has(candidate.id),
            )

            return (
              <li key={member.id}>
                <div className="household-member-list-row">
                  <span className="household-member-list-name">
                    {member.name}
                    {member.isGroup && (
                      <span className="household-member-list-type">{t('typeGroup')}</span>
                    )}
                    {!member.isActive && (
                      <span className="household-member-list-inactive">{t('inactiveLabel')}</span>
                    )}
                  </span>
                  <span className="household-member-list-actions">
                    {member.isGroup && (
                      <button
                        type="button"
                        onClick={() => toggleGroupMembers(member.id)}
                        aria-expanded={groupMembersExpanded}
                      >
                        {t('groupMembersButton', { count: groupMembers.length })}
                      </button>
                    )}
                    <button type="button" onClick={() => openEditForm(member)} disabled={isSubmitting}>
                      {t('editButton')}
                    </button>
                    {referenceCount === 0 && (
                      <button type="button" onClick={() => deleteMember(member.id)} disabled={isSubmitting}>
                        {t('deleteButton')}
                      </button>
                    )}
                    {member.isActive && (
                      <button type="button" onClick={() => deactivateMember(member.id)} disabled={isSubmitting}>
                        {t('deactivateButton')}
                      </button>
                    )}
                  </span>
                </div>

                {member.isGroup && groupMembersExpanded && (
                  <div className="household-member-group-panel">
                    {groupMembers.length === 0 ? (
                      <p>{t('groupMembersEmpty')}</p>
                    ) : (
                      <ul className="household-member-group-member-list">
                        {groupMembers.map((groupMember) => (
                          <li key={groupMember.id} className="household-member-group-member-row">
                            <span className="household-member-group-member-name">{groupMember.name}</span>
                            <button
                              type="button"
                              onClick={() => removeMemberFromGroup(member.id, groupMember.id)}
                              disabled={isSubmitting}
                            >
                              {t('groupMemberRemoveButton')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="household-member-group-add-row">
                      <label htmlFor={`household-member-group-add-${member.id}`}>
                        {t('groupMemberAddLabel')}
                      </label>
                      <select
                        id={`household-member-group-add-${member.id}`}
                        value={groupMemberInputByGroupId.get(member.id) ?? ''}
                        onChange={(event) => setGroupMemberInput(member.id, event.target.value)}
                      >
                        <option value="">{t('groupMemberAddPlaceholder')}</option>
                        {availableCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                            {candidate.isGroup ? `(${t('typeGroup')})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addMemberToGroup(member.id)}
                        disabled={(groupMemberInputByGroupId.get(member.id) ?? '') === '' || isSubmitting}
                      >
                        {t('groupMemberAddButton')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {formMode === null ? (
        <button type="button" onClick={openCreateForm} disabled={isSubmitting}>
          {t('addButton')}
        </button>
      ) : (
        <div className="household-member-form">
          <label htmlFor="household-member-name">{t('nameLabel')}</label>
          <input
            id="household-member-name"
            type="text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />

          <fieldset className="household-member-type-fieldset">
            <legend>{t('typeLabel')}</legend>
            <label>
              <input
                type="radio"
                name="household-member-type"
                checked={!isGroupInput}
                onChange={() => setIsGroupInput(false)}
              />
              {t('typeIndividual')}
            </label>
            <label>
              <input
                type="radio"
                name="household-member-type"
                checked={isGroupInput}
                onChange={() => setIsGroupInput(true)}
              />
              {t('typeGroup')}
            </label>
          </fieldset>

          <div className="household-member-form-actions">
            <button type="button" onClick={submitForm} disabled={nameInput.trim() === '' || isSubmitting}>
              {formMode === 'create' ? t('createSubmit') : t('saveSubmit')}
            </button>
            <button type="button" onClick={closeForm} disabled={isSubmitting}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
