import { useTranslation } from 'react-i18next'
import '../HubMenu.css'

export interface RecurringTransactionHubScreenProps {
  onManageRules: () => void
  onReviewProposals: () => void
  onBack: () => void
}

/**
 * 定期取引サブハブ画面(計画Issue #39)。仕訳ハブ画面(/journal)の子ルートとして、
 * 定期取引ルール管理・提案の確認という2つの画面への導線を1つのカテゴリに統合する入口。
 * 当初はルール管理画面をマスタ管理ハブ(/master)配下に、提案確認画面を仕訳ハブ配下に
 * それぞれ別々に配置していたが、「定期取引」という1つの機能が2つのハブに分断され
 * 発見しにくいというHuman Override - REJECTを受け、ExpenseSplittingHubScreenと同じ
 * パターン(仕訳ハブ配下の専用サブハブ)へ再設計した(docs/decisions.md参照)。
 * 実際の画面遷移はコールバック経由で呼び出し元(App.tsx)に委ねる、DB非依存の純粋な
 * 表示・ナビゲーションコンポーネント。
 */
export function RecurringTransactionHubScreen({
  onManageRules,
  onReviewProposals,
  onBack,
}: RecurringTransactionHubScreenProps) {
  const { t } = useTranslation('recurringTransaction')

  return (
    <div className="hub-menu-screen">
      <h2>{t('recurringTransactionHubTitle')}</h2>
      <button type="button" onClick={onManageRules}>
        {t('ruleManagementMenuButton')}
      </button>
      <button type="button" onClick={onReviewProposals}>
        {t('recurringProposalMenuButton')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
