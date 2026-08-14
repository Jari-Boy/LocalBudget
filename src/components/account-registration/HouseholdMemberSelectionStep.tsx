import { useTranslation } from 'react-i18next'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'

export interface HouseholdMemberSelectionStepProps {
  householdMembers: HouseholdMember[]
  selectedId: number | null
  onSelect: (id: number) => void
  onBack: () => void
  primaryLabel: string
  primaryDisabled: boolean
  onPrimaryAction: () => void
  error?: string | null
}

/**
 * 名義(世帯メンバー)選択ステップの共通UI(docs/domain/accounts.md 4.1節・5.1節、計画Issue #92)。
 * AccountRegistrationWizard・CreditCardRegistrationWizardの双方から、主操作ボタンの
 * 文言・活性条件・押下時の挙動(次のステップへ進む/登録を確定する)を呼び出し側から
 * 注入する形で再利用する。このステップが表示される場合は常に世帯メンバーの選択が
 * 必須(「世帯共通」の選択肢は無い)なため、primaryDisabledの計算(選択済みかどうか、
 * 送信中かどうか等)は呼び出し側の責務とする。表示要否の判定は
 * shouldShowHouseholdMemberSelectionStep(./shouldShowHouseholdMemberSelectionStep.ts)を使う。
 */
export function HouseholdMemberSelectionStep({
  householdMembers,
  selectedId,
  onSelect,
  onBack,
  primaryLabel,
  primaryDisabled,
  onPrimaryAction,
  error,
}: HouseholdMemberSelectionStepProps) {
  const { t } = useTranslation('account')

  return (
    <fieldset>
      <legend>{t('stepMemberLabel')}</legend>
      {householdMembers.map((member) => (
        <button
          key={member.id}
          type="button"
          aria-pressed={selectedId === member.id}
          onClick={() => onSelect(member.id)}
        >
          {member.name}
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
      <div>
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
        <button type="button" disabled={primaryDisabled} onClick={onPrimaryAction}>
          {primaryLabel}
        </button>
      </div>
    </fieldset>
  )
}
