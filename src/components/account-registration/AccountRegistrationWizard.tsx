import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { AccountKind } from './accountKind'
import { registerAccount, type AccountCreator, type JournalEntryCreator } from './registerAccount'
import './AccountRegistrationWizard.css'

const ACCOUNT_KINDS: AccountKind[] = ['bank', 'cash', 'e_money', 'investment']
const KIND_LABEL_KEY: Record<AccountKind, string> = {
  bank: 'kindBank',
  cash: 'kindCash',
  e_money: 'kindEMoney',
  investment: 'kindInvestment',
}

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface AccountRegistrationWizardProps {
  accountRepository: AccountCreator
  journalEntryRepository: JournalEntryCreator
  householdMemberRepository: HouseholdMemberFinder
  onComplete: (account: Account) => void
  /** 初期残高がある場合の初期仕訳の日付(YYYY-MM-DD)。省略時は本日の日付を使う */
  today?: string
}

type Step = 'kind' | 'name' | 'member' | 'balance'

/**
 * 口座登録ウィザード(docs/domain/accounts.md 4章)。種類選択→名前入力→
 * 名義選択(任意)→初期残高入力(任意)の4ステップで、裏側の勘定科目・仕訳の
 * 概念をユーザーに見せずに口座を登録する。世帯メンバーが1人も登録されて
 * いない場合、名義選択ステップは表示しない(4.1節)。
 */
export function AccountRegistrationWizard({
  accountRepository,
  journalEntryRepository,
  householdMemberRepository,
  onComplete,
  today,
}: AccountRegistrationWizardProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  /** null = 世帯メンバー一覧の読み込み中。読み込み完了前にstepsを確定させると
   * 名義選択ステップの表示要否(4.1節)がユーザー操作の途中でずれるため、
   * 読み込み完了までウィザード自体を表示しない。 */
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  const [kind, setKind] = useState<AccountKind | null>(null)
  const [name, setName] = useState('')
  const [householdMemberId, setHouseholdMemberId] = useState<number | null>(null)
  const [initialBalanceInput, setInitialBalanceInput] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const steps: Step[] =
    householdMembers.length > 0 ? ['kind', 'name', 'member', 'balance'] : ['kind', 'name', 'balance']
  const currentStep = steps[stepIndex]

  const goNext = () => setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

  const handleSubmit = async () => {
    setSubmitting(true)
    const initialBalance = initialBalanceInput === '' ? null : Number(initialBalanceInput)
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: kind!,
      name,
      householdMemberId,
      initialBalance,
      entryDate: today ?? new Date().toISOString().slice(0, 10),
    })
    setSubmitting(false)
    onComplete(account)
  }

  return (
    <div className="account-registration-wizard">
      <h2>{t('registerAccountTitle')}</h2>

      {currentStep === 'kind' && (
        <fieldset>
          <legend>{t('stepKindLabel')}</legend>
          {ACCOUNT_KINDS.map((candidateKind) => (
            <button
              key={candidateKind}
              type="button"
              aria-pressed={kind === candidateKind}
              onClick={() => {
                setKind(candidateKind)
                goNext()
              }}
            >
              {t(KIND_LABEL_KEY[candidateKind])}
            </button>
          ))}
        </fieldset>
      )}

      {currentStep === 'name' && (
        <div>
          <label htmlFor="account-name">{t('stepNameLabel')}</label>
          <input
            id="account-name"
            type="text"
            value={name}
            placeholder={t('namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
            <button type="button" disabled={name === ''} onClick={goNext}>
              {t('next')}
            </button>
          </div>
        </div>
      )}

      {currentStep === 'member' && (
        <fieldset>
          <legend>{t('stepMemberLabel')}</legend>
          <button
            type="button"
            aria-pressed={householdMemberId === null}
            onClick={() => setHouseholdMemberId(null)}
          >
            {t('memberCommon')}
          </button>
          {householdMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              aria-pressed={householdMemberId === member.id}
              onClick={() => setHouseholdMemberId(member.id)}
            >
              {member.name}
            </button>
          ))}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
            <button type="button" onClick={goNext}>
              {t('next')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'balance' && (
        <div>
          <label htmlFor="account-initial-balance">{t('stepBalanceLabel')}</label>
          <input
            id="account-initial-balance"
            type="number"
            value={initialBalanceInput}
            onChange={(event) => setInitialBalanceInput(event.target.value)}
          />
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
            <button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
              {t('register')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
