import { useTranslation } from 'react-i18next'
import '../HubMenu.css'

export interface ExpenseSplittingHubScreenProps {
  onNewSplit: () => void
  onSettlement: () => void
  onHistory: () => void
  onBack: () => void
}

/**
 * 割勘サブハブ画面(計画Issue #118)。仕訳ハブ画面(/journal)の子ルートとして、
 * 割勘の新規作成・精算・履歴という3つの画面への導線を1つのカテゴリに統合する入口。
 * ボタンラベルは各画面自身の見出し文言をそのまま再利用する。実際の画面遷移は
 * コールバック経由で呼び出し元(App.tsx)に委ねる、DB非依存の純粋な表示・
 * ナビゲーションコンポーネント。
 */
export function ExpenseSplittingHubScreen({
  onNewSplit,
  onSettlement,
  onHistory,
  onBack,
}: ExpenseSplittingHubScreenProps) {
  const { t } = useTranslation('expenseSplitting')

  return (
    <div className="hub-menu-screen">
      <h2>{t('splittingHubTitle')}</h2>
      <button type="button" onClick={onNewSplit}>
        {t('entryPickerMenuTitle')}
      </button>
      <button type="button" onClick={onSettlement}>
        {t('settlementScreenTitle')}
      </button>
      <button type="button" onClick={onHistory}>
        {t('historyMenuTitle')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
