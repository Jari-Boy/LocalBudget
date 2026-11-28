import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { AMOUNT_TICKS, stepPosition } from './amountRangeModel'
import './AmountRange.css'

export interface AmountRangeSliderProps {
  minLabel: string
  maxLabel: string
  /** 右端の目盛りと、上限の摘みが右端にあるときの読み上げ(「上限なし」) */
  noLimitLabel: string
  /** 摘みの位置(0〜100%) */
  minPosition: number
  maxPosition: number
  /** 読み上げ用の金額の文言(「1,000円」など) */
  minValueText: string
  maxValueText: string
  onMinPositionChange: (position: number) => void
  onMaxPositionChange: (position: number) => void
}

const TICK_LABELS = ['0', '1,000', '1万', '10万', '100万']

/**
 * 金額の2つ摘みのスライダー(計画Issue #314)。標準の入力部品に2つ摘みが無いので自作する。摘みは役割 slider で、
 * 矢印キー・PageUp/PageDown・Home/End で動かせ、レールのクリック・ドラッグでも動かせる。位置(%)と金額の変換や、
 * 下限が上限を越えないようにする制約は呼び出し側(AmountRangeInput)が持つ。
 */
export function AmountRangeSlider(props: AmountRangeSliderProps) {
  const { minPosition, maxPosition } = props
  const railRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'min' | 'max' | null>(null)

  const positionOf = (event: PointerEvent): number => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))
  }

  const move = (thumb: 'min' | 'max', position: number) =>
    thumb === 'min' ? props.onMinPositionChange(Math.min(position, maxPosition)) : props.onMaxPositionChange(Math.max(position, minPosition))

  const onKeyDown = (thumb: 'min' | 'max') => (event: KeyboardEvent) => {
    const next = stepPosition(thumb === 'min' ? minPosition : maxPosition, event.key)
    if (next === null) return
    event.preventDefault()
    move(thumb, next)
  }

  const onPointerDown = (event: PointerEvent) => {
    const position = positionOf(event)
    // 近いほうの摘みを動かす。同じ位置に重なっているときは、右へ引くなら上限、左へ引くなら下限
    const toMin = Math.abs(position - minPosition)
    const toMax = Math.abs(position - maxPosition)
    const thumb = toMin < toMax || (toMin === toMax && position < minPosition) ? 'min' : 'max'
    dragRef.current = thumb
    event.currentTarget.setPointerCapture?.(event.pointerId)
    move(thumb, position)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (dragRef.current !== null) move(dragRef.current, positionOf(event))
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const thumb = (which: 'min' | 'max') => {
    const position = which === 'min' ? minPosition : maxPosition
    return (
      <button
        type="button"
        role="slider"
        className="amount-slider__thumb"
        style={{ left: `${position}%` }}
        aria-label={which === 'min' ? props.minLabel : props.maxLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={which === 'min' ? props.minValueText : props.maxValueText}
        onKeyDown={onKeyDown(which)}
      />
    )
  }

  return (
    <div className="amount-slider">
      <div
        className="amount-slider__rail"
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="amount-slider__track" />
        <div className="amount-slider__fill" style={{ left: `${minPosition}%`, right: `${100 - maxPosition}%` }} />
        {thumb('min')}
        {thumb('max')}
      </div>
      <div className="amount-slider__ticks" aria-hidden="true">
        {TICK_LABELS.map((text, index) => (
          <span key={text} className="amount-slider__tick" style={{ left: `${(index * 100) / AMOUNT_TICKS.length}%` }}>
            {text}
          </span>
        ))}
        <span className="amount-slider__tick" style={{ left: '100%' }}>
          {props.noLimitLabel}
        </span>
      </div>
    </div>
  )
}
