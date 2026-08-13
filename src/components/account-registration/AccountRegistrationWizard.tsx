import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { requiresHouseholdMemberSelection, type AccountKind } from './accountKind'
import { registerAccount, type AccountCreator, type JournalEntryCreator } from './registerAccount'
import './AccountRegistrationWizard.css'

const KIND_LABEL_KEY: Record<AccountKind, string> = {
  bank: 'kindBank',
  cash: 'kindCash',
  e_money: 'kindEMoney',
  investment: 'kindInvestment',
}

/**
 * 種類選択ステップの表示グループ(docs/decisions.md参照)。銀行口座・証券口座は
 * 「口座」、現金・電子マネーは資産である点は同じだがユーザーの感覚上「口座」とは
 * 異なる(現金はそもそも口座ではない、電子マネーは決済手段としての手触りが
 * クレジットカードに近い)ため、種類選択の一覧内で視覚的に分けて表示する。
 * ドメイン上はいずれもcategory = 'asset'で同じ扱い(4.2節)であり、グルーピングは
 * 表示上の分類に留まる。
 */
const ACCOUNT_KIND_GROUPS: { labelKey: string; kinds: AccountKind[] }[] = [
  { labelKey: 'kindGroupBankAccounts', kinds: ['bank', 'investment'] },
  { labelKey: 'kindGroupCashLike', kinds: ['cash', 'e_money'] },
]

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
 * 名義選択→初期残高入力(任意)のステップで、裏側の勘定科目・仕訳の概念を
 * ユーザーに見せずに口座を登録する。名義選択ステップはkindに応じて出し分ける
 * (計画Issue #90): 銀行口座・証券口座・電子マネーは世帯メンバーを選ぶまで
 * 次へ進めない必須ステップ、現金は世帯メンバーの登録有無に関わらずステップ
 * 自体を表示しない。銀行口座等でも世帯メンバーが1人も登録されていない場合は
 * ステップ自体を表示しない(選択肢が無いため、4.1節)。現金はさらに名前入力
 * ステップも経ず、科目名を自動的に「現金」に固定する。初期残高入力も、
 * 現金かつ世帯メンバーが1人以上いる場合のみ世帯メンバーごとの金額入力に
 * 切り替わる(それ以外は単一の金額入力、4.1節)。
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
  const [balanceByMemberId, setBalanceByMemberId] = useState<Record<number, string>>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  if (householdMembers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const isCash = kind === 'cash'
  const showMemberStep =
    kind !== null && requiresHouseholdMemberSelection(kind) && householdMembers.length > 0
  const perMemberBalance = isCash && householdMembers.length > 0
  const steps: Step[] = [
    'kind',
    ...(isCash ? [] : (['name'] as const)),
    ...(showMemberStep ? (['member'] as const) : []),
    'balance',
  ]
  const currentStep = steps[stepIndex]

  const goNext = () => setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    const initialBalanceLines = perMemberBalance
      ? householdMembers.map((member) => ({
          householdMemberId: member.id,
          amount:
            balanceByMemberId[member.id] === undefined || balanceByMemberId[member.id] === ''
              ? null
              : Number(balanceByMemberId[member.id]),
        }))
      : [
          {
            householdMemberId: null,
            amount: initialBalanceInput === '' ? null : Number(initialBalanceInput),
          },
        ]
    try {
      const account = await registerAccount(accountRepository, journalEntryRepository, {
        kind: kind!,
        name: isCash ? t('kindCash') : name,
        householdMemberId,
        initialBalanceLines,
        entryDate: today ?? new Date().toISOString().slice(0, 10),
        // 初期残高がある場合の初期仕訳の起票者(計画Issue #88)。口座の名義(householdMemberId)を
        // 選んでいればそれを使う。名義選択ステップが必須のkind(bank/investment/e_money、計画Issue #90)
        // では選択済みのため常に非nullになる。現金(名義選択ステップ自体を非表示)または世帯メンバーが
        // 1件も無い場合はnullのままのため、世帯メンバーの先頭にフォールバックする
        // (seedDefaultHouseholdMemberにより最低1件は存在する想定、docs/domain/household-members.md 1.2節)。
        journalEntryHouseholdMemberId: (householdMemberId ?? householdMembers[0]?.id) as number,
      })
      onComplete(account)
    } catch {
      setError(t('registrationError'))
      setSubmitting(false)
    }
  }

  return (
    <div className="account-registration-wizard">
      <h2>{t('registerAccountTitle')}</h2>

      {currentStep === 'kind' && (
        <fieldset>
          <legend>{t('stepKindLabel')}</legend>
          {ACCOUNT_KIND_GROUPS.map((group) => (
            <div key={group.labelKey} className="account-kind-group">
              <p className="account-kind-group-label">{t(group.labelKey)}</p>
              <div className="account-kind-group-buttons">
                {group.kinds.map((candidateKind) => (
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
              </div>
            </div>
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
            <button type="button" disabled={householdMemberId === null} onClick={goNext}>
              {t('next')}
            </button>
          </div>
        </fieldset>
      )}

      {currentStep === 'balance' && (
        <div>
          {perMemberBalance ? (
            <fieldset>
              <legend>{t('stepBalancePerMemberLabel')}</legend>
              {householdMembers.map((member) => (
                <div key={member.id}>
                  <label htmlFor={`account-initial-balance-member-${member.id}`}>{member.name}</label>
                  <input
                    id={`account-initial-balance-member-${member.id}`}
                    type="number"
                    min="0"
                    value={balanceByMemberId[member.id] ?? ''}
                    onChange={(event) =>
                      setBalanceByMemberId((prev) => ({ ...prev, [member.id]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : (
            <>
              <label htmlFor="account-initial-balance">{t('stepBalanceLabel')}</label>
              <input
                id="account-initial-balance"
                type="number"
                min="0"
                value={initialBalanceInput}
                onChange={(event) => setInitialBalanceInput(event.target.value)}
              />
            </>
          )}
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
