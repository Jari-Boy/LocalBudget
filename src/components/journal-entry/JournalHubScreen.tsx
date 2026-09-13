import { useTranslation } from 'react-i18next'
import '../HubMenu.css'

export interface JournalHubScreenProps {
  onManualEntry: () => void
  onStatementImport: () => void
  onViewEntries: () => void
  onSplitting: () => void
  onRecurringProposals: () => void
  onBack: () => void
}

/**
 * 仕訳ハブ画面(計画Issue #118)。手入力起票・明細取込・仕訳一覧・割勘は
 * いずれも最終的にJournalEntryRepositoryを通じて仕訳を生成する起票方法・派生機能
 * であるため(docs/architecture.md 12章)、仕訳という1つのカテゴリに統合する入口。
 * 「手入力で起票」「明細取込」は仕訳作成の対の手段であるため、間に中間メニューを
 * 挟まず対等な2ボタンとして並べる(URLパスの接頭辞/journal/create/*でのみ
 * グルーピングを表現する)。実際の画面遷移はコールバック経由で呼び出し元(App.tsx)に
 * 委ねる、DB非依存の純粋な表示・ナビゲーションコンポーネント。
 */
export function JournalHubScreen({
  onManualEntry,
  onStatementImport,
  onViewEntries,
  onSplitting,
  onRecurringProposals,
  onBack,
}: JournalHubScreenProps) {
  const { t } = useTranslation('journal')
  const { t: tRecurringTransaction } = useTranslation('recurringTransaction')

  return (
    <div className="hub-menu-screen">
      <h2>{t('journalHubTitle')}</h2>
      <button type="button" onClick={onManualEntry}>
        {t('manualEntryMenuButton')}
      </button>
      <button type="button" onClick={onStatementImport}>
        {t('statementImportMenuButton')}
      </button>
      <button type="button" onClick={onViewEntries}>
        {t('entryListTitle')}
      </button>
      <button type="button" onClick={onSplitting}>
        {t('splittingMenuButton')}
      </button>
      <button type="button" onClick={onRecurringProposals}>
        {tRecurringTransaction('recurringProposalMenuButton')}
      </button>
      <button type="button" onClick={onBack}>
        {t('back')}
      </button>
    </div>
  )
}
