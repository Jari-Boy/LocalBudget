import { useTranslation } from 'react-i18next'
import './onboarding.css'

export interface WelcomeScreenProps {
  onNext: () => void
}

/**
 * ウェルカム画面(計画Issue #177、承認済みモックアップ①)。初回起動時に1回だけ出す。売り込みはせず、
 * リード文に「複式簿記で記帳する・サーバーを持たない・データの置き場所」をまとめ、データが消えるリスクを
 * 注意書きで添える。「前提」「データの置き場所」「最初に入るもの」の項目は置かない(実機確認での指示)。
 * 簿記の一般用語は解説しない。ボタンは「初期設定へ進む」だけで、用語集・スキップの導線も置かない。
 * 用語集はサイドナビから開く。
 */
export function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  const { t } = useTranslation('onboarding')
  const { t: tc } = useTranslation()
  // 文ごとに1行にする(文の途中で折り返さず、「。」で改行する)
  const lead = t('welcome.lead', { returnObjects: true }) as string[]
  const warning = t('welcome.warning', { returnObjects: true }) as string[]

  return (
    <div className="onboarding">
      <section className="onboarding__card">
        <div>
          <div className="onboarding__brand">{tc('appName')}</div>
          <div className="onboarding__lead">
            {lead.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="onboarding__warn">
            {warning.map((line) => (
              <p key={line}>{line}</p>
            ))}
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
