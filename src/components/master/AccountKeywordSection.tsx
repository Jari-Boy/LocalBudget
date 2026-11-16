import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import type { KeywordRuleRepository } from '../../domain/keyword-rule/KeywordRuleRepository'
import { toStoredKeyword, validateKeywordRuleInput } from './keywordRuleForm'
import type { MaybeAsync } from './maybeAsync'
import './master.css'

export interface AccountKeywordSectionProps {
  /** 資産・負債の科目(収益・費用の科目のキーワードは取引先タブで扱う) */
  account: Account
  repository: MaybeAsync<Pick<KeywordRuleRepository, 'findByAccount' | 'create' | 'update' | 'delete'>>
  busy: boolean
}

/**
 * 勘定科目タブの右パネルの「キーワード」欄(計画Issue #219)。資産・負債の科目を相手科目に直接指定した
 * キーワードルールを、一覧・追加・編集・削除できる。検証はキーワードタブ・取引先タブと共通(keywordRuleForm)。
 * 保存は操作した時点でDBへ行う(取引先タブのキーワード欄と同じ)。
 */
export function AccountKeywordSection({ account, repository, busy }: AccountKeywordSectionProps) {
  const { t } = useTranslation('master')
  const [rules, setRules] = useState<KeywordRule[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [newPattern, setNewPattern] = useState('')
  /** 「キーワードを追加」を押すと、入力欄が出る(計画Issue #219) */
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setRules(await Promise.resolve(repository.findByAccount(account.id)))
  }, [repository, account.id])

  useEffect(() => {
    void load()
  }, [load])

  const disabled = busy || working
  const trimmedNew = newPattern.trim()
  const trimmedEdit = editDraft.trim()

  /** 共通の検証。問題があれば理由を表示して、保存しない */
  const validate = (text: string, selfId: number | null): boolean => {
    const problem = validateKeywordRuleInput({
      pattern: text,
      counterpartyId: null,
      accountId: account.id,
      account,
      siblings: rules.filter((r) => r.id !== selfId),
    })
    setError(problem === null ? '' : t(`keywordTab.errors.${problem}`))
    return problem === null
  }

  const run = async (action: () => Promise<void>) => {
    setWorking(true)
    setError('')
    try {
      await action()
      await load()
    } catch {
      setError(t('keywordTab.saveError'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="master-subsection" aria-label={t('accountTab.keywordsTitle', { count: rules.length })}>
      <h3 className="master-subsection__title">{t('accountTab.keywordsTitle', { count: rules.length })}</h3>
      <p className="master-note">{t('accountTab.keywordsNote', { account: account.name })}</p>
      <ul className="master-list">
        {rules.map((rule) =>
          editingId === rule.id ? (
            <li key={rule.id} className="master-list__item">
              <input
                className="master-field__control"
                aria-label={t('counterpartyTab.patternInput')}
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
              />
              <button
                type="button"
                className="master-btn master-btn--primary"
                disabled={disabled || trimmedEdit === ''}
                onClick={() =>
                  void run(async () => {
                    if (!validate(trimmedEdit, rule.id)) return
                    await repository.update(rule.id, { pattern: toStoredKeyword(trimmedEdit) })
                    setEditingId(null)
                  })
                }
              >
                {t('counterpartyTab.patternSave')}
              </button>
              <button type="button" className="master-btn" onClick={() => setEditingId(null)}>
                {t('counterpartyTab.patternCancel')}
              </button>
            </li>
          ) : (
            <li key={rule.id} className="master-list__item">
              <span className="master-list__text">{rule.pattern}</span>
              <button
                type="button"
                className="master-btn"
                disabled={disabled}
                aria-label={t('counterpartyTab.patternEditLabel', { pattern: rule.pattern })}
                onClick={() => {
                  setEditingId(rule.id)
                  setEditDraft(rule.pattern)
                  setError('')
                }}
              >
                {t('counterpartyTab.patternEdit')}
              </button>
              <button
                type="button"
                className="master-btn"
                disabled={disabled}
                aria-label={t('counterpartyTab.patternDeleteLabel', { pattern: rule.pattern })}
                onClick={() => void run(() => Promise.resolve(repository.delete(rule.id)))}
              >
                {t('counterpartyTab.patternDelete')}
              </button>
            </li>
          ),
        )}
      </ul>
      {adding ? (
        <div className="master-list__item">
          <input
            className="master-field__control"
            aria-label={t('counterpartyTab.patternNewInput')}
            placeholder={t('counterpartyTab.patternPlaceholder')}
            value={newPattern}
            onChange={(event) => setNewPattern(event.target.value)}
          />
          <button
            type="button"
            className="master-btn master-btn--primary"
            disabled={disabled || trimmedNew === ''}
            onClick={() =>
              void run(async () => {
                if (!validate(trimmedNew, null)) return
                await repository.create({ pattern: toStoredKeyword(trimmedNew), accountId: account.id })
                setNewPattern('')
                setAdding(false)
              })
            }
          >
            {t('counterpartyTab.patternAddSubmit')}
          </button>
          <button
            type="button"
            className="master-btn"
            onClick={() => {
              setAdding(false)
              setNewPattern('')
              setError('')
            }}
          >
            {t('counterpartyTab.patternCancel')}
          </button>
        </div>
      ) : (
        <div className="master-actions">
          <button
            type="button"
            className="master-btn"
            disabled={disabled}
            onClick={() => {
              setAdding(true)
              setEditingId(null)
              setError('')
            }}
          >
            {t('counterpartyTab.patternAdd')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="master-error">
          {error}
        </p>
      )}
      <p className="master-note">{t('accountTab.keywordsPlOnlyNote')}</p>
    </section>
  )
}
