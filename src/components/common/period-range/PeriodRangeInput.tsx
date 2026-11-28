import { useMemo, useState } from 'react'
import '../journal-filter/JournalFilterPanel.css'
import './PeriodRange.css'
import { buildMonthOptions, monthOf, monthToDateRange, snapRangeToMonths } from './periodRangeModel'

export interface PeriodRangeInputProps {
  /** 左のラベル(「期間」) */
  label: string
  fromLabel: string
  toLabel: string
  /** 分析画面と同じ「日付で指定」のチェックの文言 */
  byDateLabel: string
  /** 月の選択欄で、期間の条件を付けない選択肢(「指定なし」) */
  unsetLabel: string
  /** 開始・終了の日付('YYYY-MM-DD'、空文字は指定なし) */
  from: string
  to: string
  /** 月の選択肢を作るための、仕訳(行)の日付。最も古い月から新しい月まで並べる */
  dates: readonly string[]
  /** 日付が変わった。月で選んだときは、開始月の1日〜終了月の末日にして渡す */
  onChange: (from: string, to: string) => void
}

const monthText = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`

/**
 * 期間の入力(計画Issue #314)。分析画面の期間バーと同じく、開始・終了を日付で入れるか月で選ぶかを「日付で指定」のチェックで
 * 切り替える。条件の値はどちらでも開始日・終了日の日付で、月モードは開始月の1日〜終了月の末日に変換するだけ。
 * 日付から月へ切り替えると、含まれる月の月初〜月末に広がる。仕訳一覧・割勘・明細取込の絞り込みパネルで共用する。
 */
export function PeriodRangeInput({
  label,
  fromLabel,
  toLabel,
  byDateLabel,
  unsetLabel,
  from,
  to,
  dates,
  onChange,
}: PeriodRangeInputProps) {
  const [mode, setMode] = useState<'date' | 'month'>('date')
  const fromMonth = monthOf(from)
  const toMonth = monthOf(to)
  const monthOptions = useMemo(() => buildMonthOptions(dates, [fromMonth, toMonth]), [dates, fromMonth, toMonth])

  const switchMode = (byDate: boolean) => {
    setMode(byDate ? 'date' : 'month')
    if (!byDate) {
      const snapped = snapRangeToMonths({ from, to })
      if (snapped.from !== from || snapped.to !== to) onChange(snapped.from, snapped.to)
    }
  }

  const monthSelect = (ariaLabel: string, value: string, onPick: (month: string) => void) => (
    <select
      className="journal-filter__input"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onPick(event.target.value)}
    >
      <option value="">{unsetLabel}</option>
      {monthOptions.map((month) => (
        <option key={month} value={month}>
          {monthText(month)}
        </option>
      ))}
    </select>
  )

  return (
    <div className="journal-filter__range">
      <span className="journal-filter__label">{label}</span>
      {mode === 'date' ? (
        <>
          <input
            type="date"
            className="journal-filter__input"
            aria-label={fromLabel}
            value={from}
            onChange={(event) => onChange(event.target.value, to)}
          />
          <span aria-hidden="true">〜</span>
          <input
            type="date"
            className="journal-filter__input"
            aria-label={toLabel}
            value={to}
            onChange={(event) => onChange(from, event.target.value)}
          />
        </>
      ) : (
        <>
          {monthSelect(fromLabel, fromMonth, (month) => onChange(monthToDateRange(month, '').from, to))}
          <span aria-hidden="true">〜</span>
          {monthSelect(toLabel, toMonth, (month) => onChange(from, monthToDateRange('', month).to))}
        </>
      )}
      <label className="period-range__check">
        <input type="checkbox" checked={mode === 'date'} onChange={(event) => switchMode(event.target.checked)} />
        {byDateLabel}
      </label>
    </div>
  )
}
