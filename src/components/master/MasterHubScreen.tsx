import { useTranslation } from 'react-i18next'
import '../HubMenu.css'

export interface MasterHubScreenProps {
  onManageAccounts: () => void
  onManageCounterparties: () => void
  onManageHouseholdMembers: () => void
  onManageProjects: () => void
  onBack: () => void
}

/**
 * マスタ管理ハブ画面(計画Issue #118)。ホーム画面に分散していた「科目管理」
 * 「取引先管理」「世帯メンバー管理」「プロジェクト管理」への導線を、マスタ管理という
 * 1つのカテゴリに統合する入口。ボタンラベルは各画面自身の見出し文言をそのまま再利用する
 * (科目管理ハブ画面(AccountManagementScreen)がホーム画面のボタンラベルとして
 * accountManagementTitleを再利用していた既存の慣習を踏襲)。実際の画面遷移は
 * コールバック経由で呼び出し元(App.tsx)に委ねる、DB非依存の純粋な表示・
 * ナビゲーションコンポーネント。
 */
export function MasterHubScreen({
  onManageAccounts,
  onManageCounterparties,
  onManageHouseholdMembers,
  onManageProjects,
  onBack,
}: MasterHubScreenProps) {
  const { t } = useTranslation('master')
  const { t: tAccount } = useTranslation('account')
  const { t: tCounterparty } = useTranslation('counterparty')
  const { t: tHouseholdMember } = useTranslation('householdMember')
  const { t: tProject } = useTranslation('project')

  return (
    <div className="hub-menu-screen">
      <h2>{t('masterManagementTitle')}</h2>
      <button type="button" onClick={onManageAccounts}>
        {tAccount('accountManagementTitle')}
      </button>
      <button type="button" onClick={onManageCounterparties}>
        {tCounterparty('viewCounterpartiesTitle')}
      </button>
      <button type="button" onClick={onManageHouseholdMembers}>
        {tHouseholdMember('viewHouseholdMembersTitle')}
      </button>
      <button type="button" onClick={onManageProjects}>
        {tProject('viewProjectsTitle')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
