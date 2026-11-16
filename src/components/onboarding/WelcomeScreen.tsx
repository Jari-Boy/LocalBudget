import { useTranslation } from 'react-i18next'
import './onboarding.css'

export interface WelcomeScreenProps {
  onNext: () => void
}

/**
 * ウェルカム画面(計画Issue #177、承認済みモックアップ①)。初回起動時に1回だけ出す。売り込みはせず、
 * 前提(簿記の知識が要ること)とデータの所在とリスクを開示する。簿記の一般用語は
 * 解説しない。ボタンは「初期設定へ進む」だけで、用語集・スキップの導線は置かない(実機確認での指示)。
 * 用語集はサイドナビから開く。
 */
export function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  const { t } = useTranslation('onboarding')
  const { t: tc } = useTranslation()

  return (
    <div className="onboarding">
      <section className="onboarding__card">
        <div>
          <div className="onboarding__brand">{tc('appName')}</div>
          <p className="onboarding__lead">{t('welcome.lead')}</p>
        </div>
        <div className="onboarding__facts">
          <div className="onboarding__fact">
            <h3>{t('welcome.premise.title')}</h3>
            <div>
              <p>{t('welcome.premise.line1')}</p>
              <p>{t('welcome.premise.line2')}</p>
            </div>
          </div>
          <div className="onboarding__fact">
            <h3>{t('welcome.storage.title')}</h3>
            <div>
              <p>{t('welcome.storage.body')}</p>
              <p className="onboarding__warn">{t('welcome.storage.warning')}</p>
            </div>
          </div>
        </div>
        <div className="onboarding__actions">
          <button type="button" className="onboarding__button onboarding__button--primary" onClick={onNext}>
            {t('welcome.next')}
          </button>
        </div>
      </section>
    </div>
  )
}
