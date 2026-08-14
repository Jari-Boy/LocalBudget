import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { HouseholdMemberSelectionStep } from './HouseholdMemberSelectionStep'
import { shouldShowHouseholdMemberSelectionStep } from './shouldShowHouseholdMemberSelectionStep'
import { registerAccount, type AccountCreator, type JournalEntryCreator } from './registerAccount'
import { registerRevenueOrExpenseAccount } from './registerRevenueOrExpenseAccount'
import { reconciliationAnswerToIsReconcilable } from './reconciliationQuestion'
import './AccountRegistrationFlow.css'

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface AccountRegistrationFlowProps {
  accountRepository: AccountCreator
  journalEntryRepository: JournalEntryCreator
  householdMemberRepository: HouseholdMemberFinder
  onComplete: (account: Account) => void
  /** 最初のステップ(入口)で「戻る」を押した際に呼ばれる、フロー自体を抜けるコールバック */
  onBack: () => void
  /** 初期残高がある場合の初期仕訳の日付(YYYY-MM-DD)。省略時は本日の日付を使う */
  today?: string
}

type EntryChoice = 'asset_liability' | 'revenue_expense'
type AssetLiabilityCategory = Extract<AccountCategory, 'asset' | 'liability'>
type RevenueExpenseCategory = Extract<AccountCategory, 'revenue' | 'expense'>

type Step =
  | 'entry'
  | 'category'
  | 'external-statement'
  | 'balance-in-statement'
  | 'member'
  | 'name'
  | 'balance'

const NAME_PLACEHOLDER_KEY: Record<AssetLiabilityCategory | RevenueExpenseCategory, string> = {
  asset: 'namePlaceholderAsset',
  liability: 'namePlaceholderLiability',
  revenue: 'namePlaceholderRevenue',
  expense: 'namePlaceholderExpense',
}

/**
 * 勘定科目の統合登録フロー(docs/domain/accounts.md 4章、計画Issue #102)。
 * 従来3画面(口座登録ウィザード・クレジットカード登録ウィザード・その他の科目を追加する
 * フォーム)に分かれていた新規登録を1本のフローに統合し、is_reconcilableの決定を
 * 「口座の種類」による特別扱いではなく「外部明細(CSV)の有無」×「残高情報の有無」という
 * 2軸の設問(reconciliationQuestion.ts)に一般化する。
 *
 * 入口で「資産・負債」か「収益・費用」かを選び、前者はさらに資産/負債を選んだ後、
 * 外部明細の有無→(ありの場合のみ)残高情報の有無→名義選択(外部明細ありは必須・
 * なしは任意、HouseholdMemberSelectionStepの任意モードを使う)→科目名→初期残高(任意)
 * と進む。後者はカテゴリ(収益/費用)選択→科目名の2ステップのみで完結し、名義選択・
 * 初期残高入力のステップは持たない(is_reconcilableは常にnull)。
 */
export function AccountRegistrationFlow({
  accountRepository,
  journalEntryRepository,
  householdMemberRepository,
  onComplete,
  onBack,
  today,
}: AccountRegistrationFlowProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  const [entryChoice, setEntryChoice] = useState<EntryChoice | null>(null)
  const [category, setCategory] = useState<AssetLiabilityCategory | RevenueExpenseCategory | null>(null)
  const [hasExternalStatement, setHasExternalStatement] = useState<boolean | null>(null)
  const [hasBalanceInStatement, setHasBalanceInStatement] = useState<boolean | null>(null)
  const [householdMemberId, setHouseholdMemberId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [initialBalanceInput, setInitialBalanceInput] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const isAssetLiability = entryChoice === 'asset_liability'
  const isRevenueExpense = entryChoice === 'revenue_expense'
  const memberStepRequired = hasExternalStatement === true
  const showMemberStep =
    isAssetLiability && hasExternalStatement !== null && shouldShowHouseholdMemberSelectionStep(householdMembers)

  const steps: Step[] =
    entryChoice === null
      ? ['entry']
      : isAssetLiability
        ? [
            'entry',
            'category',
            'external-statement',
            ...(hasExternalStatement ? (['balance-in-statement'] as const) : []),
            ...(showMemberStep ? (['member'] as const) : []),
            'name',
            'balance',
          ]
        : ['entry', 'category', 'name']
  const currentStep = steps[stepIndex]

  /**
   * ステップを1つ進める。上限クランプ(steps.length - 1)はあえて設けない。
   * goNextは常に、そのクリックハンドラ内でentryChoice/category/hasExternalStatement等
   * 分岐を決める状態を同時に更新する箇所から呼ばれるため、このレンダー時点のstepsは
   * まだ更新前の状態から計算された「古い」配列になっている。上限クランプをかけると
   * 更新後は本来7ステップあるはずが更新前の1ステップ(steps.length - 1 = 0)で
   * 頭打ちになり、ステップが進まなくなる。次のレンダーで新しいstateから再計算された
   * stepsに対してstepIndexを引くため、単純にインクリメントするだけでよい。
   */
  const goNext = () => setStepIndex((index) => index + 1)
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))
  const isLastStep = stepIndex === steps.length - 1

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      let account: Account
      if (isAssetLiability) {
        const isReconcilable = reconciliationAnswerToIsReconcilable({
          hasExternalStatement: hasExternalStatement!,
          hasBalanceInStatement,
        })
        account = await registerAccount(accountRepository, journalEntryRepository, {
          category: category as AssetLiabilityCategory,
          isReconcilable,
          name,
          householdMemberId,
          initialBalanceLines: [
            {
              householdMemberId: null,
              amount: initialBalanceInput === '' ? null : Number(initialBalanceInput),
            },
          ],
          entryDate: today ?? new Date().toISOString().slice(0, 10),
          // 初期残高がある場合の初期仕訳の起票者(計画Issue #88)。名義を選んでいればそれを使い、
          // 未選択(外部明細なしの任意選択で「全員」のまま、または世帯メンバーが1件も無い)
          // 場合は世帯メンバーの先頭にフォールバックする(seedDefaultHouseholdMemberにより
          // 最低1件は存在する想定、docs/domain/household-members.md 1.2節)。
          journalEntryHouseholdMemberId: (householdMemberId ?? householdMembers[0]?.id) as number,
        })
      } else {
        account = await registerRevenueOrExpenseAccount(accountRepository, {
          category: category as RevenueExpenseCategory,
          name,
        })
      }
      onComplete(account)
    } catch {
      setError(t('registrationError'))
      setSubmitting(false)
    }
  }

  return (
    <div className="account-registration-wizard">
      <h2>{t('accountRegistrationFlowTitle')}</h2>

      {currentStep === 'entry' && (
        <fieldset>
          <legend>{t('entryStepLabel')}</legend>
          <div>
            <button
              type="button"
              aria-pressed={entryChoice === 'asset_liability'}
              onClick={() => {
                setEntryChoice('asset_liability')
                setCategory(null)
                goNext()
              }}
            >
              {t('entryChoiceAssetLiability')}
            </button>
            <p className="account-registration-hint">{t('entryChoiceAssetLiabilityCaption')}</p>
          </div>
          <div>
            <button
              type="button"
              aria-pressed={entryChoice === 'revenue_expense'}
              onClick={() => {
                setEntryChoice('revenue_expense')
                setCategory(null)
                goNext()
              }}
            >
              {t('entryChoiceRevenueExpense')}
            </button>
            <p className="account-registration-hint">{t('entryChoiceRevenueExpenseCaption')}</p>
          </div>
          <div>
            <button type="button" onClick={onBack}>
              {t('back')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'category' && isAssetLiability && (
        <fieldset>
          <legend>{t('assetLiabilityCategoryStepLabel')}</legend>
          {(['asset', 'liability'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={category === candidate}
              onClick={() => {
                setCategory(candidate)
                goNext()
              }}
            >
              {t(candidate === 'asset' ? 'assetLiabilityCategoryAsset' : 'assetLiabilityCategoryLiability')}
            </button>
          ))}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'category' && isRevenueExpense && (
        <fieldset>
          <legend>{t('revenueExpenseCategoryStepLabel')}</legend>
          {(['revenue', 'expense'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={category === candidate}
              onClick={() => {
                setCategory(candidate)
                goNext()
              }}
            >
              {t(candidate === 'revenue' ? 'categoryRevenue' : 'categoryExpense')}
            </button>
          ))}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'external-statement' && (
        <fieldset>
          <legend>{t('hasExternalStatementQuestionLabel')}</legend>
          {([true, false] as const).map((answer) => (
            <button
              key={String(answer)}
              type="button"
              aria-pressed={hasExternalStatement === answer}
              onClick={() => {
                setHasExternalStatement(answer)
                if (!answer) {
                  setHasBalanceInStatement(null)
                }
                goNext()
              }}
            >
              {t(answer ? 'answerYes' : 'answerNo')}
            </button>
          ))}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'balance-in-statement' && (
        <fieldset>
          <legend>{t('hasBalanceInStatementQuestionLabel')}</legend>
          {([true, false] as const).map((answer) => (
            <button
              key={String(answer)}
              type="button"
              aria-pressed={hasBalanceInStatement === answer}
              onClick={() => {
                setHasBalanceInStatement(answer)
                goNext()
              }}
            >
              {t(answer ? 'answerYes' : 'answerNo')}
            </button>
          ))}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'member' && (
        <HouseholdMemberSelectionStep
          householdMembers={householdMembers}
          selectedId={householdMemberId}
          onSelect={setHouseholdMemberId}
          onBack={goBack}
          primaryLabel={t('next')}
          primaryDisabled={memberStepRequired && householdMemberId === null}
          onPrimaryAction={goNext}
          unspecifiedOptionLabel={memberStepRequired ? undefined : t('memberUnspecified')}
        />
      )}

      {currentStep === 'name' && (
        <div>
          <label htmlFor="account-name">{t('stepNameLabel')}</label>
          <input
            id="account-name"
            type="text"
            value={name}
            placeholder={t(NAME_PLACEHOLDER_KEY[category as AssetLiabilityCategory | RevenueExpenseCategory])}
            onChange={(event) => setName(event.target.value)}
          />
          {error && isLastStep && <p role="alert">{error}</p>}
          <div>
            <button type="button" onClick={goBack}>
              {t('back')}
            </button>
            {isLastStep ? (
              <button type="button" disabled={name === '' || submitting} onClick={() => void handleSubmit()}>
                {t('register')}
              </button>
            ) : (
              <button type="button" disabled={name === ''} onClick={goNext}>
                {t('next')}
              </button>
            )}
          </div>
        </div>
      )}

      {currentStep === 'balance' && (
        <div>
          <label htmlFor="account-initial-balance">{t('stepBalanceLabel')}</label>
          <input
            id="account-initial-balance"
            type="number"
            min="0"
            value={initialBalanceInput}
            onChange={(event) => setInitialBalanceInput(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
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
