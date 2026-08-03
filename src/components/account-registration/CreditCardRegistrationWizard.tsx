import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { AccountCreator } from './registerAccount'
import { registerCreditCard } from './registerCreditCard'
import './AccountRegistrationWizard.css'

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface CreditCardRegistrationWizardProps {
  accountRepository: AccountCreator
  householdMemberRepository: HouseholdMemberFinder
  onComplete: (account: Account) => void
}

type Step = 'name' | 'member'

/**
 * クレジットカード登録ウィザード(docs/domain/accounts.md 5章)。名前入力→
 * 名義選択(任意)の2ステップで、口座登録(4章)と異なり種類選択・初期残高
 * 入力のステップは持たない(5.1節)。世帯メンバーが1人も登録されていない
 * 場合、名義選択ステップは表示しない(口座登録ウィザードと同じ扱い)。
 */
export function CreditCardRegistrationWizard({
  accountRepository,
  householdMemberRepository,
  onComplete,
}: CreditCardRegistrationWizardProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  const [name, setName] = useState('')
  const [householdMemberId, setHouseholdMemberId] = useState<number | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const steps: Step[] = householdMembers.length > 0 ? ['name', 'member'] : ['name']
  const currentStep = steps[stepIndex]

  const goNext = () => setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

  const handleSubmit = async () => {
    setSubmitting(true)
    const account = await registerCreditCard(accountRepository, { name, householdMemberId })
    setSubmitting(false)
    onComplete(account)
  }

  return (
    <div className="account-registration-wizard">
      <h2>{t('registerCreditCardTitle')}</h2>

      {currentStep === 'name' && (
        <div>
          <label htmlFor="credit-card-name">{t('stepNameLabel')}</label>
          <input
            id="credit-card-name"
            type="text"
            value={name}
            placeholder={t('namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
          <div>
            {steps.length > 1 ? (
              <button type="button" disabled={name === ''} onClick={goNext}>
                {t('next')}
              </button>
            ) : (
              <button type="button" disabled={name === '' || submitting} onClick={() => void handleSubmit()}>
                {t('register')}
              </button>
            )}
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
            <button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
              {t('register')}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  )
}
