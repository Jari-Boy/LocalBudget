import { useTranslation } from 'react-i18next'
import './AccountManagementMenu.css'

export interface AccountCategorySelectionScreenProps {
  onSelectAsset: () => void
  onSelectCreditCard: () => void
  onSelectOther: () => void
  onBack: () => void
}

/**
 * 科目カテゴリ選択画面(計画Issue #95)。科目管理ハブ画面の「科目を追加する」導線から
 * 遷移し、「資産(口座)を登録する」(既存AccountRegistrationWizardへ)・
 * 「クレジットカードを登録する」(既存CreditCardRegistrationWizardへ)・
 * 「その他の科目を追加する」(新規のOtherAccountCreationFormへ)の3択に分岐する。
 * 実際の画面遷移はコールバック経由で呼び出し元(App.tsx)に委ねる、DB非依存の
 * 純粋な表示・ナビゲーションコンポーネント。
 */
export function AccountCategorySelectionScreen({
  onSelectAsset,
  onSelectCreditCard,
  onSelectOther,
  onBack,
}: AccountCategorySelectionScreenProps) {
  const { t } = useTranslation('account')

  return (
    <div className="account-menu-screen">
      <h2>{t('categorySelectionTitle')}</h2>
      <div className="account-menu-item">
        <button type="button" onClick={onSelectAsset}>
          {t('registerAccountTitle')}
        </button>
        <p className="account-menu-item-caption">{t('categorySelectionAssetCaption')}</p>
      </div>
      <div className="account-menu-item">
        <button type="button" onClick={onSelectCreditCard}>
          {t('registerCreditCardTitle')}
        </button>
        <p className="account-menu-item-caption">{t('categorySelectionCreditCardCaption')}</p>
      </div>
      <div className="account-menu-item">
        <button type="button" onClick={onSelectOther}>
          {t('otherAccountFormTitle')}
        </button>
        <p className="account-menu-item-caption">{t('categorySelectionOtherCaption')}</p>
      </div>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
