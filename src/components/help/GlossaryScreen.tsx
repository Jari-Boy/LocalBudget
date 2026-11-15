import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterGlossaryTerms, type GlossaryEntry } from '../../domain/help/filterGlossaryTerms'
import { SettlementBatchWalkthrough } from './SettlementBatchWalkthrough'
import './GlossaryScreen.css'

/** 用語集の区分(タブの並び)と、区分ごとの用語のid(表示の並び)。文言は辞書(help.json)にある。 */
const GLOSSARY_CATEGORIES = ['people', 'account', 'entry', 'settlement', 'storage'] as const

const TERM_IDS: Record<(typeof GLOSSARY_CATEGORIES)[number], readonly string[]> = {
  people: ['member', 'memberGroup', 'bookkeeper', 'counterparty', 'project'],
  account: ['category', 'account', 'systemAccount', 'initialBalance', 'accountGroup', 'deactivate', 'merge'],
  entry: ['statement', 'import', 'anchor', 'balanceAdjustment', 'draft', 'journalTemplate', 'recurring'],
  settlement: ['split', 'batch', 'settle'],
  storage: ['storage', 'backup'],
}

/** 精算バッチの項目だけが持つ、例と流れの詳細(折りたたみ)へのリンクがある用語 */
const TERMS_WITH_DETAIL: readonly string[] = ['batch']

const CATEGORY_TAG_CLASS: Record<(typeof GLOSSARY_CATEGORIES)[number], string> = {
  people: 'purple',
  account: 'blue',
  entry: 'orange',
  settlement: 'neutral',
  storage: 'neutral',
}

export interface GlossaryScreenProps {
  /** 渡されたときだけ「戻る」ボタンを出す(初回セットアップの画面から開いたとき。サイドナビからは不要) */
  onBack?: () => void
}

/**
 * 用語集画面(計画Issue #177、承認済みモックアップ④)。LocalBudget特有の言葉を、区分のタブ(「すべて」は無い)で
 * 切り替えて読む。検索語があるときは区分に関わらず全区分から探す。精算バッチの項目からは、旅行代を友人と
 * 折半する例の詳細(SettlementBatchWalkthrough)を折りたたみで開ける。簿記の一般用語は載せない。
 */
export function GlossaryScreen({ onBack }: GlossaryScreenProps) {
  const { t } = useTranslation('help')
  const [category, setCategory] = useState<string>(GLOSSARY_CATEGORIES[0])
  const [query, setQuery] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)

  const entries = useMemo<GlossaryEntry[]>(
    () =>
      GLOSSARY_CATEGORIES.flatMap((cat) =>
        TERM_IDS[cat].map((id) => ({
          id,
          category: cat,
          term: t(`glossary.terms.${id}.term`),
          description: t(`glossary.terms.${id}.description`),
          bookkeeping: t(`glossary.terms.${id}.bookkeeping`, { defaultValue: '' }) || undefined,
        })),
      ),
    [t],
  )
  const shown = filterGlossaryTerms(entries, { category, query })
  const searching = query.trim() !== ''

  return (
    <section className="glossary" aria-labelledby="glossary-title">
      <div className="glossary__head">
        <h1 id="glossary-title" className="glossary__title">
          {t('glossary.title')}
        </h1>
        {onBack && (
          <button type="button" className="glossary__button" onClick={onBack}>
            {t('glossary.back')}
          </button>
        )}
      </div>
      <p className="glossary__lead">{t('glossary.lead')}</p>

      <div className="glossary__tools">
        <input
          type="search"
          className="glossary__input"
          aria-label={t('glossary.searchLabel')}
          placeholder={t('glossary.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="glossary__cats" role="group" aria-label={t('glossary.categoriesLabel')}>
          {GLOSSARY_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="glossary__tab"
              aria-pressed={!searching && cat === category}
              onClick={() => {
                setCategory(cat)
                setQuery('')
              }}
            >
              {t(`glossary.categories.${cat}`)}
            </button>
          ))}
        </div>
        <p className="glossary__count" aria-live="polite">
          {searching
            ? t('glossary.countInSearch', { count: shown.length })
            : t('glossary.countInCategory', { category: t(`glossary.categories.${category}`), count: shown.length })}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="glossary__empty">{t('glossary.empty')}</p>
      ) : (
        <div className="glossary__list">
          {shown.map((entry) => {
            const cat = entry.category as (typeof GLOSSARY_CATEGORIES)[number]
            return (
              <article key={entry.id} className="glossary__term">
                <h3 className="glossary__term-title">
                  {entry.term}{' '}
                  <span className={`glossary__tag glossary__tag--${CATEGORY_TAG_CLASS[cat]}`}>
                    {t(`glossary.categories.${cat}`)}
                  </span>
                </h3>
                <p>{entry.description}</p>
                {entry.bookkeeping && (
                  <p className="glossary__muted">
                    <b>{t('glossary.bookkeepingLabel')}</b> {entry.bookkeeping}
                  </p>
                )}
                {TERMS_WITH_DETAIL.includes(entry.id) && (
                  <button type="button" className="glossary__link" onClick={() => setDetailOpen(true)}>
                    {t('glossary.openBatchDetail')}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}

      <details
        className="glossary__detail"
        data-testid="batch-detail"
        open={detailOpen}
        onToggle={(event) => setDetailOpen(event.currentTarget.open)}
      >
        <summary>{t('batch.summary')}</summary>
        {detailOpen && <SettlementBatchWalkthrough />}
      </details>
    </section>
  )
}
