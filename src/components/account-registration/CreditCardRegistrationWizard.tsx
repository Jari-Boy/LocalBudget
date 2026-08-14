import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { AccountCreator } from './registerAccount'
import { registerCreditCard } from './registerCreditCard'
import { HouseholdMemberSelectionStep } from './HouseholdMemberSelectionStep'
import { shouldShowHouseholdMemberSelectionStep } from './shouldShowHouseholdMemberSelectionStep'
import './AccountRegistrationWizard.css'

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface CreditCardRegistrationWizardProps {
  accountRepository: AccountCreator
  householdMemberRepository: HouseholdMemberFinder
  onComplete: (account: Account) => void
  /** 最初のステップ(名前入力)で「戻る」を押した際に呼ばれる、ウィザード自体を抜ける
   * コールバック(計画Issue #95、科目カテゴリ選択画面への復帰に使用) */
  onBack: () => void
}

type Step = 'name' | 'member'

/**
 * クレジットカード登録ウィザード(docs/domain/accounts.md 5章)。名前入力→
 * 名義選択の2ステップで、口座登録(4章)と異なり種類選択・初期残高入力の
 * ステップは持たない(5.1節)。名義はクレジットカードという性質上常に必須
 * (計画Issue #90)で、世帯メンバーを選ぶまで登録できない。世帯メンバーが
 * 1人も登録されていない場合のみ、選択肢が無いため名義選択ステップ自体を
 * 表示しない(口座登録ウィザードと同じ扱い)。
 */
export function CreditCardRegistrationWizard({
  accountRepository,
  householdMemberRepository,
  onComplete,
  onBack,
}: CreditCardRegistrationWizardProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  const [name, setName] = useState('')
  const [householdMemberId, setHouseholdMemberId] = useState<number | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const steps: Step[] = shouldShowHouseholdMemberSelectionStep(householdMembers)
    ? ['name', 'member']
    : ['name']
  const currentStep = steps[stepIndex]

  const goNext = () => setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const account = await registerCreditCard(accountRepository, { name, householdMemberId })
      onComplete(account)
    } catch {
      setError(t('registrationError'))
      setSubmitting(false)
    }
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
            placeholder={t('namePlaceholderCreditCard')}
            onChange={(event) => setName(event.target.value)}
          />
          {error && steps.length === 1 && <p role="alert">{error}</p>}
          <div>
            <button type="button" onClick={onBack} disabled={submitting}>
              {t('back')}
            </button>
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
        <HouseholdMemberSelectionStep
          householdMembers={householdMembers}
          selectedId={householdMemberId}
          onSelect={setHouseholdMemberId}
          onBack={goBack}
          primaryLabel={t('register')}
          primaryDisabled={submitting || householdMemberId === null}
          onPrimaryAction={() => void handleSubmit()}
          error={error}
        />
      )}
    </div>
  )
}
