import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { listAccountBalances, type AccountBalance } from '../../domain/financial-statement/listAccountBalances'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './AccountListScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface AccountListScreenProps {
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryFinder
  householdMemberRepository: HouseholdMemberFinder
  onBack: () => void
}

interface LoadedData {
  balances: AccountBalance[]
  householdMemberNameById: Map<number, string>
}

/**
 * 登録済み科目一覧確認画面(計画Issue #70)。isSystemManaged科目(初期残高科目等の
 * 内部管理用科目)を除いた登録済み全科目を、区分を問わずフラットな一覧として
 * 名称・残高とともに表示する。householdMemberIdが設定された科目には
 * 世帯メンバー名を併記する。並び順はAccountRepository.findAll()の返り順(登録順)
 * をそのまま使い、UI層での独自ソートは行わない。
 */
export function AccountListScreen({
  accountRepository,
  journalEntryRepository,
  householdMemberRepository,
  onBack,
}: AccountListScreenProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)

  useEffect(() => {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
    ]).then(([accounts, entries, householdMembers]) => {
      const visibleAccounts = accounts.filter((account) => !account.isSystemManaged)
      setData({
        balances: listAccountBalances(entries, visibleAccounts),
        householdMemberNameById: new Map(householdMembers.map((member) => [member.id, member.name])),
      })
    })
  }, [accountRepository, journalEntryRepository, householdMemberRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  return (
    <div className="account-list-screen">
      <h2>{t('accountListTitle')}</h2>

      {data.balances.length === 0 ? (
        <p>{t('accountListEmpty')}</p>
      ) : (
        <ul>
          {data.balances.map((balance) => (
            <li key={balance.accountId}>
              <span className="account-list-name">
                {balance.accountName}
                {balance.householdMemberId !== null && (
                  <span className="account-list-member">
                    {data.householdMemberNameById.get(balance.householdMemberId)}
                  </span>
                )}
              </span>
              <span className="account-list-amount">{formatCurrency(balance.amount, 'JPY')}</span>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
