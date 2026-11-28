import '../journal-filter/JournalFilterPanel.css'
import { AmountRangeSlider } from './AmountRangeSlider'
import { rangeToThumbs, sliderCap, thumbsToRange } from './amountRangeModel'
import './AmountRange.css'

export interface AmountRangeInputProps {
  /** 左のラベル(「金額」) */
  label: string
  minLabel: string
  maxLabel: string
  /** 上限の入力欄の空欄の表示と、スライダー右端の文言(「上限なし」) */
  noLimitLabel: string
  /** 数字入力の文字。空欄は条件なし */
  minText: string
  maxText: string
  /** 表示している仕訳(行)の最大金額。スライダーの右端の手前の目盛りの上限になる */
  dataMax: number
  onMinTextChange: (text: string) => void
  onMaxTextChange: (text: string) => void
}

/** 数字として読める入力だけを金額にする。空欄・読めない入力はnull(条件なし扱いでスライダーの端に置く) */
function parseAmount(text: string): number | null {
  if (text.trim() === '') return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : null
}

const yen = (amount: number) => `${amount.toLocaleString('ja-JP')}円`

/**
 * 金額の範囲の入力(計画Issue #314)。数字入力(下限〜上限)と、2つ摘みのスライダーを1つの枠にまとめる。両者は双方向に同期し、
 * スライダーの右端(100%)は上限なし(空欄)。目盛りの範囲を超える入力値は摘みを端に寄せて表示するが、入力欄の値はそのまま保つ。
 * 仕訳一覧・割勘・明細取込の絞り込みパネルで共用する。条件の値は呼び出し側が文字列で持つ(明細取込と仕訳で型が違うため)。
 */
export function AmountRangeInput(props: AmountRangeInputProps) {
  const cap = sliderCap(props.dataMax)
  const min = parseAmount(props.minText)
  const max = parseAmount(props.maxText)
  const { minPosition, maxPosition } = rangeToThumbs(min, max, cap)

  const emit = (onTextChange: (text: string) => void, value: number | null) =>
    onTextChange(value === null ? '' : String(value))

  return (
    <div className="amount-range">
      <div className="journal-filter__range">
        <span className="journal-filter__label">{props.label}</span>
        <input
          type="text"
          inputMode="numeric"
          className="journal-filter__input journal-filter__input--amount"
          aria-label={props.minLabel}
          value={props.minText}
          onChange={(event) => props.onMinTextChange(event.target.value)}
        />
        <span aria-hidden="true">〜</span>
        <input
          type="text"
          inputMode="numeric"
          className="journal-filter__input journal-filter__input--amount"
          aria-label={props.maxLabel}
          placeholder={props.noLimitLabel}
          value={props.maxText}
          onChange={(event) => props.onMaxTextChange(event.target.value)}
        />
      </div>
      <AmountRangeSlider
        // 数字入力と同じ名前にすると、画面読み上げ・テストで区別できなくなるため「のスライダー」を付ける
        minLabel={`${props.minLabel}のスライダー`}
        maxLabel={`${props.maxLabel}のスライダー`}
        noLimitLabel={props.noLimitLabel}
        minPosition={minPosition}
        maxPosition={maxPosition}
        minValueText={yen(min ?? 0)}
        maxValueText={max === null ? props.noLimitLabel : yen(max)}
        onMinPositionChange={(position) => emit(props.onMinTextChange, thumbsToRange(position, maxPosition, cap).min)}
        onMaxPositionChange={(position) => emit(props.onMaxTextChange, thumbsToRange(minPosition, position, cap).max)}
      />
    </div>
  )
}
