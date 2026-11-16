import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import type { KeywordRuleRepository } from '../../domain/keyword-rule/KeywordRuleRepository'
import {
  nextSortState,
  sortKeywordRules,
  toStoredKeyword,
  validateKeywordRuleInput,
  type KeywordSortKey,
  type KeywordSortState,
} from './keywordRuleForm'
import type { MaybeAsync } from './maybeAsync'
import './master.css'

export interface KeywordMasterTabProps {
  keywordRuleRepository: MaybeAsync<Pick<KeywordRuleRepository, 'findAll' | 'create' | 'update' | 'delete'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll'>>
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
}

interface Draft {
  /** 編集中のルールのid。新規追加ならnull */
  id: number | null
  pattern: string
  counterpartyId: number | null
  accountId: number | null
}

const NEW_DRAFT: Draft = { id: null, pattern: '', counterpartyId: null, accountId: null }

const isPlCategory = (account: Pick<Account, 'category'> | null | undefined) =>
  account?.category === 'revenue' || account?.category === 'expense'

/**
 * マスタ画面の「キーワード」タブ(計画Issue #219)。摘要のキーワードから取引先(任意)と相手科目(任意)を
 * 推定するルール(keyword_rules)を、左に一覧・右に編集パネルで扱う。列見出しを押すと、その列で昇順・降順に並べ替える。
 * 相手科目が資産・負債のときは取引先を指定できない。検証は勘定科目・取引先タブと共通(keywordRuleForm)。
 */
export function KeywordMasterTab({ keywordRuleRepository, counterpartyRepository, accountRepository }: KeywordMasterTabProps) {
  const { t } = useTranslation('master')
  const [rules, setRules] = useState<KeywordRule[]>([])
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [sort, setSort] = useState<KeywordSortState>({ key: 'pattern', direction: 'asc' })
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [nextRules, nextCounterparties, nextAccounts] = await Promise.all([
      Promise.resolve(keywordRuleRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
    ])
    setRules(nextRules)
    setCounterparties(nextCounterparties)
    setAccounts(nextAccounts)
  }, [keywordRuleRepository, counterpartyRepository, accountRepository])

  useEffect(() => {
    void load()
  }, [load])

  const counterpartyName = useCallback((id: number | null) => counterparties.find((c) => c.id === id)?.name ?? '', [counterparties])
  const accountName = useCallback((id: number | null) => accounts.find((a) => a.id === id)?.name ?? '', [accounts])
  /** 相手科目の列の表示: 科目を持てばその名前、取引先だけなら取引先の既定の科目(灰色) */
  const accountCell = useCallback(
    (rule: KeywordRule) => {
      if (rule.accountId !== null) return { text: accountName(rule.accountId), muted: false }
      const fallback = counterparties.find((c) => c.id === rule.counterpartyId)?.defaultAccountId ?? null
      return fallback === null
        ? { text: '', muted: true }
        : { text: t('keywordTab.fromCounterpartyDefault', { account: accountName(fallback) }), muted: true }
    },
    [accountName, counterparties, t],
  )

  const visibleRules = useMemo(() => {
    const keyword = toStoredKeyword(query)
    const filtered =
      keyword === ''
        ? rules
        : rules.filter((r) =>
            [r.pattern, counterpartyName(r.counterpartyId), accountName(r.accountId)].some((text) => toStoredKeyword(text).includes(keyword)),
          )
    return sortKeywordRules(filtered, sort, { counterparty: counterpartyName, account: accountName })
  }, [rules, query, sort, counterpartyName, accountName])

  const selectedAccount = draft?.accountId == null ? null : (accounts.find((a) => a.id === draft.accountId) ?? null)
  const counterpartyLocked = selectedAccount !== null && !isPlCategory(selectedAccount)

  const save = async () => {
    if (!draft) return
    const problem = validateKeywordRuleInput({
      pattern: draft.pattern,
      counterpartyId: draft.counterpartyId,
      accountId: draft.accountId,
      account: selectedAccount,
      siblings: rules.filter((r) => r.id !== draft.id),
    })
    if (problem) {
      setError(t(`keywordTab.errors.${problem}`))
      return
    }
    setBusy(true)
    setError('')
    try {
      const input = { pattern: toStoredKeyword(draft.pattern), counterpartyId: draft.counterpartyId, accountId: draft.accountId }
      if (draft.id === null) await Promise.resolve(keywordRuleRepository.create(input))
      else await Promise.resolve(keywordRuleRepository.update(draft.id, input))
      setDraft(null)
      await load()
    } catch {
      setError(t('keywordTab.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!draft || draft.id === null) return
    setBusy(true)
    try {
      await Promise.resolve(keywordRuleRepository.delete(draft.id))
      setDraft(null)
      setError('')
      await load()
    } catch {
      setError(t('keywordTab.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const header = (key: KeywordSortKey, label: string) => {
    const active = sort.key === key
    return (
      <th scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="master-table__sort" onClick={() => setSort(nextSortState(sort, key))}>
          {label}
          {active && (
            <span aria-hidden="true" className="master-table__sort-mark">
              {sort.direction === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </button>
      </th>
    )
  }

  const title = draft?.id === null ? t('keywordTab.newTitle') : t('keywordTab.editTitle')

  return (
    <div className="master-split">
      <div className="master-split__main">
        <div className="master-actions">
          <button
            type="button"
            className="master-btn"
            onClick={() => {
              setDraft(NEW_DRAFT)
              setError('')
            }}
          >
            {t('keywordTab.add')}
          </button>
          <input
            className="master-field__control"
            aria-label={t('keywordTab.search')}
            placeholder={t('keywordTab.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {rules.length === 0 ? (
          <p className="master-note">{t('keywordTab.empty')}</p>
        ) : (
          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  {header('pattern', t('keywordTab.colPattern'))}
                  {header('counterparty', t('keywordTab.colCounterparty'))}
                  {header('account', t('keywordTab.colAccount'))}
                </tr>
              </thead>
              <tbody>
                {visibleRules.map((rule) => {
                  const cell = accountCell(rule)
                  return (
                    <tr key={rule.id} className={draft?.id === rule.id ? 'master-table__row--selected' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="master-list__button"
                          onClick={() => {
                            setDraft({ id: rule.id, pattern: rule.pattern, counterpartyId: rule.counterpartyId, accountId: rule.accountId })
                            setError('')
                          }}
                        >
                          {rule.pattern}
                        </button>
                      </td>
                      <td>{counterpartyName(rule.counterpartyId)}</td>
                      <td className={cell.muted ? 'master-note' : undefined}>{cell.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="master-note">{t('keywordTab.sortHint')}</p>
      </div>
      {draft && (
        <section className="master-panel" aria-label={title}>
          <h2 className="master-panel__title">{title}</h2>
          <div className="master-field">
            <label className="master-field__label" htmlFor="kw-pattern">
              {t('keywordTab.patternLabel')}
            </label>
            <input
              id="kw-pattern"
              className="master-field__control"
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
          </div>
          <div className="master-field">
            <label className="master-field__label" htmlFor="kw-counterparty">
              {t('keywordTab.counterpartyLabel')}
            </label>
            <select
              id="kw-counterparty"
              className="master-field__control"
              disabled={counterpartyLocked}
              value={counterpartyLocked || draft.counterpartyId === null ? '' : String(draft.counterpartyId)}
              onChange={(e) => setDraft({ ...draft, counterpartyId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">{t('keywordTab.none')}</option>
              {counterparties
                .filter((c) => c.isActive || c.id === draft.counterpartyId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            {counterpartyLocked && <span className="master-note">{t('keywordTab.counterpartyDisabledNote')}</span>}
          </div>
          <div className="master-field">
            <label className="master-field__label" htmlFor="kw-account">
              {t('keywordTab.accountLabel')}
            </label>
            <select
              id="kw-account"
              className="master-field__control"
              value={draft.accountId === null ? '' : String(draft.accountId)}
              onChange={(e) => {
                const accountId = e.target.value === '' ? null : Number(e.target.value)
                const next = accounts.find((a) => a.id === accountId)
                // 資産・負債の科目に変えたら、併記できない取引先は外す
                setDraft({ ...draft, accountId, counterpartyId: next !== undefined && !isPlCategory(next) ? null : draft.counterpartyId })
              }}
            >
              <option value="">{t('keywordTab.none')}</option>
              {accounts
                .filter((a) => (a.isActive && !a.isSystemManaged) || a.id === draft.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="master-error">
              {error}
            </p>
          )}
          <div className="master-actions">
            <button type="button" className="master-btn master-btn--primary" disabled={busy} onClick={() => void save()}>
              {t('keywordTab.save')}
            </button>
            {draft.id !== null && (
              <button type="button" className="master-btn" disabled={busy} onClick={() => void remove()}>
                {t('keywordTab.delete')}
              </button>
            )}
            <button type="button" className="master-btn" onClick={() => setDraft(null)}>
              {t('keywordTab.cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
