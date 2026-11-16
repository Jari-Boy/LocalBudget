import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnboardingChecklist as ChecklistState } from '../../infrastructure/db/onboarding'
import './OnboardingChecklist.css'

export interface OnboardingChecklistProps {
  /** Worker側のチェックリストAPI(RPC越しなのでPromiseで受ける) */
  api: {
    getChecklist(): Promise<ChecklistState>
    dismissChecklist(): Promise<void>
    markBackupDone(): Promise<void>
  }
  /** 項目のボタン・リンクを押したときの画面遷移(本番はnavigate) */
  onOpen: (path: string) => void
}

interface StepView {
  key: 'accounts' | 'registerAccount' | 'addMember' | 'firstEntry' | 'backup'
  done: boolean
  path: string
}

/**
 * はじめのチェックリスト(計画Issue #177、承認済みモックアップ③)。初回セットアップを済ませた利用者の仕訳画面の
 * 見出しの下に出す、抜け漏れ防止の案内(操作の解説ではない)。各項目の達成はWorker側がDBの状態から求める。
 * 「勘定科目を確認する」は最初から済み。バックアップだけは状態から分からないので、利用者が「済みにする」を押す。
 * 閉じるか、必須の項目がすべて済むと、以後は出さない。状態を読めないときも何も出さず、画面の利用を妨げない。
 */
export function OnboardingChecklist({ api, onOpen }: OnboardingChecklistProps) {
  const { t } = useTranslation('onboarding')
  const [state, setState] = useState<ChecklistState | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api.getChecklist())
    } catch {
      setState(null)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (state === null || !state.visible) return null

  const steps: StepView[] = [
    { key: 'accounts', done: true, path: '/master/accounts' },
    { key: 'registerAccount', done: state.steps.registerAccount, path: '/master/accounts' },
    { key: 'addMember', done: state.steps.addMember, path: '/master/household-members' },
    { key: 'firstEntry', done: state.steps.firstEntry, path: '/journal/create/import' },
    { key: 'backup', done: state.steps.backup, path: '/settings' },
  ]
  const doneCount = steps.filter((step) => step.done).length

  function describe(step: StepView['key']): string {
    if (step === 'accounts') {
      return t('checklist.accounts.description', {
        revenue: state!.accountCounts.revenue,
        expense: state!.accountCounts.expense,
      })
    }
    if (step === 'addMember') return t('checklist.addMember.description', { name: state!.memberName ?? '' })
    return t(`checklist.${step}.description`)
  }

  async function markBackupDone() {
    try {
      await api.markBackupDone()
    } finally {
      await refresh()
    }
  }

  async function dismiss() {
    try {
      await api.dismissChecklist()
    } finally {
      setState(null)
    }
  }

  return (
    <section className="onboarding-checklist" aria-labelledby="onboarding-checklist-title">
      <div className="onboarding-checklist__head">
        <h2 id="onboarding-checklist-title" className="onboarding-checklist__title">
          {t('checklist.title')}
        </h2>
        <span className="onboarding-checklist__count">{t('checklist.count', { done: doneCount, total: steps.length })}</span>
      </div>

      {steps.map((step) => (
        <div key={step.key} className="onboarding-checklist__step" data-step data-done={step.done}>
          {step.key === 'backup' && !step.done ? (
            <button
              type="button"
              className="onboarding-checklist__check"
              aria-label={t('checklist.backup.markDone')}
              onClick={() => void markBackupDone()}
            />
          ) : (
            <span className={`onboarding-checklist__check${step.done ? ' onboarding-checklist__check--done' : ''}`} aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
          )}
          <div>
            <div className="onboarding-checklist__step-title">{t(`checklist.${step.key}.title`)}</div>
            <div className="onboarding-checklist__step-description">{describe(step.key)}</div>
          </div>
          <button
            type="button"
            className={`onboarding-checklist__button${step.key === 'registerAccount' && !step.done ? ' onboarding-checklist__button--primary' : ''}`}
            onClick={() => onOpen(step.path)}
          >
            {t(`checklist.${step.key}.button`)}
          </button>
        </div>
      ))}

      <div className="onboarding-checklist__footer">
        <button type="button" className="onboarding-checklist__link" onClick={() => onOpen('/glossary')}>
          {t('checklist.glossary')}
        </button>
        <button type="button" className="onboarding-checklist__link onboarding-checklist__link--muted" onClick={() => void dismiss()}>
          {t('checklist.dismiss')}
        </button>
      </div>
    </section>
  )
}
