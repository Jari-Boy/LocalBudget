import { useTranslation } from 'react-i18next'
import type { AnalysisLine } from '../../domain/analysis/listAnalysisLines'
import { signedYen, yen } from './analysisFormat'

/** 内訳の1区画(例: 「費用」の仕訳行)。合計は、グラフの金額と一致する。 */
export interface AnalysisLineSection {
  key: string
  name: string
  lines: readonly AnalysisLine[]
  /** 符号つきで表示する(純資産の増減など) */
  signed?: boolean
}

/** ホバーで出す行の数(金額の大きい順) */
export const TOOLTIP_LINE_COUNT = 5

const byAmountDesc = (a: AnalysisLine, b: AnalysisLine) => Math.abs(b.amount) - Math.abs(a.amount) || a.date.localeCompare(b.date)

const total = (lines: readonly AnalysisLine[]) => lines.reduce((sum, l) => sum + l.amount, 0)

function LineRow({
  line,
  signed,
  onOpen,
}: {
  line: AnalysisLine
  signed: boolean
  onOpen?: (line: AnalysisLine) => void
}) {
  const content = (
    <>
      <span className="analysis-lines__date">{line.date.slice(5).replace('-', '/')}</span>
      <span className="analysis-lines__memo-cell">
        <span data-testid="analysis-line-memo">{line.memo ?? ''}</span>
        <span className="analysis-lines__account"> ・{line.accountName}</span>
      </span>
      <span className="analysis__num">{signed ? signedYen(line.amount) : yen(line.amount)}</span>
    </>
  )
  return onOpen ? (
    <button type="button" className="analysis-lines__row analysis-lines__row--button" onClick={() => onOpen(line)}>
      {content}
    </button>
  ) : (
    <div className="analysis-lines__row">{content}</div>
  )
}

export interface AnalysisLineSectionsProps {
  sections: readonly AnalysisLineSection[]
  /** 渡すと、金額の大きい順にこの行数だけを出し、残りは「ほかN行」にする(ホバー用) */
  limit?: number
  /** 渡すと、行を押せるボタンにする(固定表示用。仕訳一覧へ移動する) */
  onOpenLine?: (line: AnalysisLine) => void
}

/**
 * グラフ・内訳の「対象の仕訳行」(計画Issue #155)。区画ごとに見出し(名前・合計・行数)と行を出す。
 * ホバー用はlimit行(金額順の上位)と「ほかN行・クリックで全行を表示」、固定表示用は全行で、
 * 行から仕訳一覧へ移動できる。DB非依存。
 */
export function AnalysisLineSections({ sections, limit, onOpenLine }: AnalysisLineSectionsProps) {
  const { t } = useTranslation('analysis')
  return (
    <div className="analysis-lines">
      {sections.map((section) => {
        const sorted = [...section.lines].sort(byAmountDesc)
        const shown = limit === undefined ? sorted : sorted.slice(0, limit)
        const rest = sorted.length - shown.length
        return (
          <div key={section.key} className="analysis-lines__section">
            <div className="analysis-lines__title">
              {t('charts.lines.sectionTitle', {
                name: section.name,
                amount: section.signed ? signedYen(total(sorted)) : yen(total(sorted)),
                count: sorted.length,
              })}
            </div>
            {shown.map((line) => (
              <LineRow key={line.lineId} line={line} signed={section.signed ?? false} onOpen={onOpenLine} />
            ))}
            {sorted.length === 0 && <div className="analysis-lines__none">{t('charts.lines.none')}</div>}
            {limit !== undefined && sorted.length > 0 && (
              <div className="analysis-lines__more">
                {rest > 0 ? `${t('charts.lines.more', { count: rest })} ・ ` : ''}
                {t('charts.lines.pinHint')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
