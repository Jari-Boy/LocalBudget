import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { AccountCreator } from './registerAccount'
import { registerOtherAccount } from './registerOtherAccount'
import type { ReconciliationAnswer } from './reconciliationQuestion'
import './AccountRegistrationWizard.css'

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface OtherAccountCreationFormProps {
  accountRepository: AccountCreator
  householdMemberRepository: HouseholdMemberFinder
  onComplete: (account: Account) => void
  onBack: () => void
}

/**
 * 新規作成可能な区分の選択肢(docs/domain/accounts.md 1.2節)。純資産(equity)は
 * システム管理科目専用でDDLトリガーprevent_user_created_equity_accountにより
 * ユーザー作成を禁止済みのため、選択肢に含めない。
 */
const CATEGORY_OPTIONS: { value: AccountCategory; labelKey: string }[] = [
  { value: 'asset', labelKey: 'categoryAsset' },
  { value: 'liability', labelKey: 'categoryLiability' },
  { value: 'revenue', labelKey: 'categoryRevenue' },
  { value: 'expense', labelKey: 'categoryExpense' },
]

/** 名前入力ステップのプレースホルダーは区分ごとの具体例にする */
const NAME_PLACEHOLDER_KEY: Record<AccountCategory, string> = {
  asset: 'namePlaceholderOtherAsset',
  liability: 'namePlaceholderOtherLiability',
  equity: 'namePlaceholder',
  revenue: 'namePlaceholderRevenue',
  expense: 'namePlaceholderExpense',
}

/**
 * 「その他の科目を追加する」フォーム(計画Issue #95)。口座登録・クレジットカード登録
 * ウィザードがカバーしない用途(docs/domain/accounts.md 1.2節の「未収金」、収益・費用科目、
 * 将来のローン・立替金等)向けの汎用的な科目作成フォーム。区分選択・名前入力・
 * 名義選択(任意)に加え、資産・負債を選んだ場合のみreconciliationQuestion.tsの設問を
 * 表示してis_reconcilableを決定する(4.2節「将来の科目作成UI拡張に向けた土台」)。
 */
export function OtherAccountCreationForm({
  accountRepository,
  householdMemberRepository,
  onComplete,
  onBack,
}: OtherAccountCreationFormProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  const [category, setCategory] = useState<AccountCategory>('asset')
  const [name, setName] = useState('')
  const [reconciliationAnswer, setReconciliationAnswer] = useState<ReconciliationAnswer | null>(null)
  const [householdMemberId, setHouseholdMemberId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const requiresReconciliationAnswer = category === 'asset' || category === 'liability'
  const canSubmit = name.trim() !== '' && (!requiresReconciliationAnswer || reconciliationAnswer !== null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const account = await registerOtherAccount(accountRepository, {
        category,
        name,
        householdMemberId,
        reconciliationAnswer: requiresReconciliationAnswer
          ? (reconciliationAnswer as ReconciliationAnswer)
          : undefined,
      })
      onComplete(account)
    } catch {
      setError(t('registrationError'))
      setSubmitting(false)
    }
  }

  return (
    <div className="account-registration-wizard">
      <h2>{t('otherAccountFormTitle')}</h2>

      <div>
        <label htmlFor="other-account-category">{t('categoryLabel')}</label>
        <select
          id="other-account-category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as AccountCategory)
            setReconciliationAnswer(null)
          }}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>

        <label htmlFor="other-account-name">{t('stepNameLabel')}</label>
        <input
          id="other-account-name"
          type="text"
          value={name}
          placeholder={t(NAME_PLACEHOLDER_KEY[category])}
          onChange={(event) => setName(event.target.value)}
        />

        {requiresReconciliationAnswer && (
          <fieldset>
            <legend>{t('reconciliationQuestionLabel')}</legend>
            <div>
              <label>
                <input
                  type="radio"
                  name="other-account-reconciliation-answer"
                  checked={reconciliationAnswer === 'matches_external_statement'}
                  onChange={() => setReconciliationAnswer('matches_external_statement')}
                />
                {t('reconciliationAnswerMatchesExternalStatement')}
              </label>
              <label>
                <input
                  type="radio"
                  name="other-account-reconciliation-answer"
                  checked={reconciliationAnswer === 'manual_only'}
                  onChange={() => setReconciliationAnswer('manual_only')}
                />
                {t('reconciliationAnswerManualOnly')}
              </label>
            </div>
          </fieldset>
        )}

        <label htmlFor="other-account-member">{t('memberSelectLabel')}</label>
        <select
          id="other-account-member"
          value={householdMemberId ?? ''}
          onChange={(event) =>
            setHouseholdMemberId(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          <option value="">{t('memberUnspecified')}</option>
          {householdMembers
            .filter((member) => member.isActive || member.id === householdMemberId)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>

        {error && <p role="alert">{error}</p>}

        <div>
          <button type="button" onClick={onBack} disabled={submitting}>
            {t('back')}
          </button>
          <button type="button" disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {t('register')}
          </button>
        </div>
      </div>
    </div>
  )
}
