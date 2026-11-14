import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { listDeletionBlocks, summarizeMasterUsage } from '../../domain/master/summarizeMasterUsage'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { describeDeletionBlocks } from './describeDeletionBlocks'
import type { MaybeAsync } from './maybeAsync'
import { uniqueName } from './uniqueName'
import './master.css'

export interface MemberMasterTabProps {
  householdMemberRepository: MaybeAsync<
    Pick<
      HouseholdMemberRepository,
      | 'findAll'
      | 'create'
      | 'update'
      | 'delete'
      | 'deactivate'
      | 'activate'
      | 'addGroupMember'
      | 'removeGroupMember'
      | 'findGroupMembers'
    >
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll'>>
}

interface LoadedData {
  members: HouseholdMember[]
  accounts: Account[]
  entries: JournalEntry[]
  rules: RecurringTransactionRule[]
  /** グループのidごとの構成メンバー */
  groupMembers: Map<number, HouseholdMember[]>
}

/**
 * マスタ画面の「世帯メンバー」タブ(計画Issue #154)。個人とグループを名称・種類・状態の表で
 * 一覧し、選んだ行を右パネルで編集する。名称の変更、グループの構成メンバーの追加・解除
 * (チェックですぐ保存、現行の世帯メンバー管理画面から引き継ぐ)、有効/無効、2回押しの削除ができる。
 * 仕訳の明細・仕訳の起票者・科目の名義・定期仕訳ルールで使用中のメンバーは削除できず、理由を表示する。
 * 種類(個人/グループ)は作成後に変えられない(docs/domain/household-members.md 1.5)。
 */
export function MemberMasterTab({
  householdMemberRepository,
  accountRepository,
  journalEntryRepository,
  recurringTransactionRuleRepository,
}: MemberMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 未保存の編集があれば、行の選択・新規作成の前に確認を通す(計画Issue #190) */
  const guarded = useGuardedAction()

  const load = useCallback(async () => {
    const [members, accounts, entries, rules] = await Promise.all([
      householdMemberRepository.findAll(),
      accountRepository.findAll(),
      journalEntryRepository.findAll(),
      recurringTransactionRuleRepository.findAll(),
    ])
    const groups = members.filter((m) => m.isGroup)
    const lists = await Promise.all(groups.map((g) => householdMemberRepository.findGroupMembers(g.id)))
    setData({ members, accounts, entries, rules, groupMembers: new Map(groups.map((g, i) => [g.id, lists[i]])) })
  }, [householdMemberRepository, accountRepository, journalEntryRepository, recurringTransactionRuleRepository])

  useEffect(() => {
    void load()
  }, [load])

  const usage = useMemo(
    () =>
      data
        ? summarizeMasterUsage({
            entries: data.entries,
            budgets: [],
            rules: data.rules,
            settlementBatches: [],
            accounts: data.accounts,
          })
        : null,
    [data],
  )

  if (data === null || usage === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  /** 操作を実行する。成功したらtrue、失敗してエラー文言を出したらfalse */
  const run = async (action: () => unknown, errorMessage: string, successMessage = ''): Promise<boolean> => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await action()
      await load()
      setFlash(successMessage)
      return true
    } catch {
      setError(errorMessage)
      return false
    } finally {
      setBusy(false)
    }
  }

  const select = (id: number | null) => {
    setSelectedId(id)
    setArmed(false)
    setFlash('')
    setError('')
  }

  const add = (isGroup: boolean) =>
    run(async () => {
      const base = isGroup ? t('memberTab.newGroupName') : t('memberTab.newMemberName')
      const created = await householdMemberRepository.create({
        name: uniqueName(base, data.members.map((m) => m.name)),
        isGroup,
      })
      select(created.id)
    }, t('accountTab.createError'))

  const selected = data.members.find((m) => m.id === selectedId)
  const typeText = (m: HouseholdMember) =>
    m.isGroup
      ? t('memberTab.typeGroupWith', { names: (data.groupMembers.get(m.id) ?? []).map((x) => x.name).join('・') })
      : t('memberTab.typeIndividual')

  return (
    <div className="master-split">
      <div className="master-split__main">
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void add(false))}>
            {t('memberTab.addMember')}
          </button>
          <button type="button" className="master-btn" disabled={busy} onClick={() => guarded(() => void add(true))}>
            {t('memberTab.addGroup')}
          </button>
        </div>
        <div className="master-table-wrap">
          <table className="master-table">
            <thead>
              <tr>
                <th>{t('accountTab.name')}</th>
                <th>{t('memberTab.type')}</th>
                <th>{t('memberTab.state')}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className={m.id === selectedId ? 'master-table__row--selected' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="master-link"
                      aria-current={m.id === selectedId ? 'true' : undefined}
                      onClick={() => guarded(() => select(m.id))}
                    >
                      {m.name}
                    </button>
                  </td>
                  <td>{typeText(m)}</td>
                  <td>{m.isActive ? t('memberTab.active') : t('memberTab.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p role="alert" className="master-error master-split__alert">
          {error}
        </p>
      )}

      {selected && (
        <MemberPanel
          key={selected.id}
          member={selected}
          candidates={data.members.filter((m) => !m.isGroup)}
          groupMembers={data.groupMembers.get(selected.id) ?? []}
          busy={busy}
          flash={flash}
          armed={armed}
          blockedText={describeDeletionBlocks(listDeletionBlocks('householdMember', usage.get('householdMember', selected.id)), t)}
          onSave={(name) =>
            run(() => householdMemberRepository.update(selected.id, { name }), t('accountTab.saveError'), t('accountTab.saved'))
          }
          onToggleGroupMember={(memberId, included) =>
            run(
              () =>
                included
                  ? householdMemberRepository.removeGroupMember(selected.id, memberId)
                  : householdMemberRepository.addGroupMember(selected.id, memberId),
              t('accountTab.saveError'),
            )
          }
          onToggleActive={() =>
            run(
              () => (selected.isActive ? householdMemberRepository.deactivate(selected.id) : householdMemberRepository.activate(selected.id)),
              t('accountTab.toggleError'),
            )
          }
          onDelete={() => {
            if (!armed) {
              setArmed(true)
              return
            }
            void run(async () => {
              await householdMemberRepository.delete(selected.id)
              setSelectedId(null)
              setArmed(false)
            }, t('accountTab.deleteError'))
          }}
        />
      )}
    </div>
  )
}

interface MemberPanelProps {
  member: HouseholdMember
  candidates: readonly HouseholdMember[]
  groupMembers: readonly HouseholdMember[]
  busy: boolean
  flash: string
  armed: boolean
  blockedText: string
  onSave: (name: string) => Promise<boolean>
  onToggleGroupMember: (memberId: number, included: boolean) => void
  onToggleActive: () => void
  onDelete: () => void
}

/** 選んだ世帯メンバーの右パネル。名称は下書きを持ち、「保存」で確定する */
function MemberPanel(props: MemberPanelProps) {
  const { member, busy } = props
  const { t } = useTranslation('master')
  const [name, setName] = useState(member.name)
  // 名称が保存済みの値と違う間は、画面を離れる前に確認する(計画Issue #190)
  const unsavedDialog = useUnsavedEditGuard({
    dirty: name.trim() !== member.name,
    save: () => (name.trim() === '' ? Promise.resolve(false) : props.onSave(name.trim())),
  })

  return (
    <section className="master-panel" aria-label={t('memberTab.edit')}>
      <h2 className="master-panel__title">{t('memberTab.edit')}</h2>

      <div className="master-field">
        <label className="master-field__label" htmlFor="member-edit-name">
          {t('accountTab.name')}
        </label>
        <input
          id="member-edit-name"
          className="master-field__control"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="master-field">
        <span className="master-field__label">{t('memberTab.typeFixed')}</span>
        <span>{member.isGroup ? t('memberTab.typeGroup') : t('memberTab.typeIndividual')}</span>
      </div>

      {member.isGroup && (
        <fieldset className="master-fieldset">
          <legend className="master-field__label">{t('memberTab.groupMembers')}</legend>
          {props.candidates.map((c) => {
            const included = props.groupMembers.some((g) => g.id === c.id)
            return (
              <label key={c.id} className="master-check">
                <input
                  type="checkbox"
                  checked={included}
                  disabled={busy}
                  onChange={() => props.onToggleGroupMember(c.id, included)}
                />
                {c.name}
              </label>
            )
          })}
        </fieldset>
      )}

      <div className="master-actions">
        <button
          type="button"
          className="master-btn master-btn--primary"
          disabled={busy || name.trim() === ''}
          onClick={() => props.onSave(name.trim())}
        >
          {t('accountTab.save')}
        </button>
        <button
          type="button"
          className={`master-btn${props.armed ? ' master-btn--danger' : ''}`}
          disabled={busy || props.blockedText !== ''}
          onClick={props.onDelete}
        >
          {props.armed ? t('accountTab.deleteConfirm') : t('accountTab.delete')}
        </button>
        <button type="button" className="master-btn" disabled={busy} onClick={props.onToggleActive}>
          {t(member.isActive ? 'accountTab.deactivate' : 'accountTab.activate')}
        </button>
        <span role="status" className="master-flash">
          {props.flash}
        </span>
      </div>

      {props.blockedText !== '' && <p className="master-note">{props.blockedText}</p>}
      {unsavedDialog}
    </section>
  )
}
