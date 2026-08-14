import { useTranslation } from 'react-i18next'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'

export interface HouseholdMemberSelectionStepProps {
  householdMembers: HouseholdMember[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  onBack: () => void
  primaryLabel: string
  primaryDisabled: boolean
  onPrimaryAction: () => void
  error?: string | null
  /**
   * 指定した場合、このラベルの未選択オプション(「全員」相当)をボタン一覧の先頭に
   * 表示し、任意選択モードになる(計画Issue #102、外部明細が無い資産・負債の名義選択)。
   * 省略時は必須モード(表示される場合は常に世帯メンバーの選択が必須、計画Issue #90)のまま。
   */
  unspecifiedOptionLabel?: string
}

/**
 * 名義(世帯メンバー)選択ステップの共通UI(docs/domain/accounts.md 4.1節・5.1節、計画Issue #92)。
 * 各呼び出し元から、主操作ボタンの文言・活性条件・押下時の挙動(次のステップへ進む/
 * 登録を確定する)を注入する形で再利用する。必須モード(unspecifiedOptionLabel省略)では
 * primaryDisabledの計算(選択済みかどうか、送信中かどうか等)は呼び出し側の責務とする。
 * 任意モード(unspecifiedOptionLabelを指定)では「全員」相当のボタンをクリックすると
 * onSelectにnullが渡される(計画Issue #102、外部明細が無い資産・負債向け)。表示要否の
 * 判定は必須/任意いずれのモードでもshouldShowHouseholdMemberSelectionStep
 * (./shouldShowHouseholdMemberSelectionStep.ts)を使う。
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
  unspecifiedOptionLabel,
}: HouseholdMemberSelectionStepProps) {
  const { t } = useTranslation('account')

  return (
    <fieldset>
      <legend>{t('stepMemberLabel')}</legend>
      {unspecifiedOptionLabel !== undefined && (
        <button type="button" aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
          {unspecifiedOptionLabel}
        </button>
      )}
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
