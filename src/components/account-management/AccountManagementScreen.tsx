import { useTranslation } from 'react-i18next'
import './AccountManagementMenu.css'

export interface AccountManagementScreenProps {
  onAddAccount: () => void
  onViewList: () => void
  onManageGroups: () => void
  onBack: () => void
}

/**
 * 科目管理ハブ画面(計画Issue #95、計画Issue #112でグループ管理導線を追加)。
 * ホーム画面に分散していた「資産を登録する」「クレジットカードを登録する」
 * 「登録済みの科目を見る」の3画面を統合する入口として、「科目を追加する」
 * (カテゴリ選択画面を経て登録画面へ)・「科目一覧を見る」(編集・削除・非アクティブ化が
 * 可能な一覧画面へ)・「グループを管理する」(勘定科目グループのCRUD画面へ)の
 * 3つの導線を提供する。実際の画面遷移はコールバック経由で呼び出し元(App.tsx)に
 * 委ねる、DB非依存の純粋な表示・ナビゲーションコンポーネント。
 */
export function AccountManagementScreen({
  onAddAccount,
  onViewList,
  onManageGroups,
  onBack,
}: AccountManagementScreenProps) {
  const { t } = useTranslation('account')

  return (
    <div className="account-menu-screen">
      <h2>{t('accountManagementTitle')}</h2>
      <button type="button" onClick={onAddAccount}>
        {t('addAccountMenuButton')}
      </button>
      <button type="button" onClick={onViewList}>
        {t('viewListMenuButton')}
      </button>
      <button type="button" onClick={onManageGroups}>
        {t('manageGroupsMenuButton')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
