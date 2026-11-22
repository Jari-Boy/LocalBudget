import { useTranslation } from 'react-i18next'
import { pageNumbers, pageRange } from './importTabs'

export interface ImportPagerProps {
  /** そのタブの全体の件数 */
  total: number
  /** いまのページ(1始まり) */
  page: number
  pageSize: number
  onPage: (page: number) => void
}

/**
 * 明細取込画面の一覧のページ送り(計画Issue #263)。タブごとに、表の下に置く。
 * 「1–50 / N件」と、前へ・ページ番号・次へを出す(遠いページは「…」で省く)。1ページに収まるときは範囲だけ。
 */
export function ImportPager({ total, page, pageSize, onPage }: ImportPagerProps) {
  const { t } = useTranslation('statementImport')
  if (total === 0) return null
  const range = pageRange({ total, page, pageSize })
  const numbers = pageNumbers(range.page, range.pageCount)
  return (
    <nav aria-label={t('pagerLabel')} className="import-pager">
      <span className="import-pager__range">{t('pagerRange', { from: range.from, to: range.to, total })}</span>
      {numbers.length > 0 && (
        <span className="import-pager__nav">
          <button
            type="button"
            className="import-pager__btn"
            aria-label={t('pagerPrev')}
            disabled={range.page <= 1}
            onClick={() => onPage(range.page - 1)}
          >
            ‹
          </button>
          {numbers.map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="import-pager__gap">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className="import-pager__btn"
                aria-label={t('pagerPage', { page: item })}
                aria-current={item === range.page ? 'page' : undefined}
                onClick={() => onPage(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className="import-pager__btn"
            aria-label={t('pagerNext')}
            disabled={range.page >= range.pageCount}
            onClick={() => onPage(range.page + 1)}
          >
            ›
          </button>
        </span>
      )}
    </nav>
  )
}
