import { useTranslation } from 'react-i18next'
import './onboarding.css'

export interface WelcomeScreenProps {
  onNext: () => void
  onOpenGlossary: () => void
  /** 初期設定をせずに始める(何も変えず、完了済みにする) */
  onSkip: () => void
}

/**
 * ウェルカム画面(計画Issue #177、承認済みモックアップ①)。初回起動時に1回だけ出す。売り込みはせず、
 * 前提(簿記の知識が要ること)、データの所在とリスク、最初に自動で入るものを開示する。簿記の一般用語は
 * 解説せず、LocalBudget特有の言葉は用語集へ案内する。スキップできる(計画Issue #177の制約)。
 */
export function WelcomeScreen({ onNext, onOpenGlossary, onSkip }: WelcomeScreenProps) {
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
              <p>{t('welcome.premise.body')}</p>
              <p className="onboarding__muted">{t('welcome.premise.note')}</p>
            </div>
          </div>
          <div className="onboarding__fact">
            <h3>{t('welcome.storage.title')}</h3>
            <div>
              <p>{t('welcome.storage.body')}</p>
              <p className="onboarding__warn">{t('welcome.storage.warning')}</p>
            </div>
          </div>
          <div className="onboarding__fact">
            <h3>{t('welcome.initial.title')}</h3>
            <div>
              <p>{t('welcome.initial.body')}</p>
              <p className="onboarding__muted">{t('welcome.initial.note')}</p>
            </div>
          </div>
        </div>
        <div className="onboarding__actions">
          <button type="button" className="onboarding__button onboarding__button--primary" onClick={onNext}>
            {t('welcome.next')}
          </button>
          <button type="button" className="onboarding__link" onClick={onOpenGlossary}>
            {t('welcome.glossary')}
          </button>
          <button type="button" className="onboarding__link" onClick={onSkip}>
            {t('welcome.later')}
          </button>
          <span className="onboarding__muted">{t('welcome.changeLater')}</span>
        </div>
      </section>
    </div>
  )
}
