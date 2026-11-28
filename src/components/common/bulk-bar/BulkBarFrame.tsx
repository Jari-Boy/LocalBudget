import type { ReactNode } from 'react'
import './BulkBarFrame.css'

export interface BulkBarFrameProps {
  /** 領域の名前(読み上げ・テストの取得に使う) */
  ariaLabel: string
  /** 領域の役割。省略すると region(section)。取込画面は従来どおり group */
  role?: 'group'
  /** 1段目の左: 選択件数・案内・結果の文。画面ごとに中身を決める */
  summary: ReactNode
  onClearSelection: () => void
  /** 適用ボタンの文言(「N行に適用」など) */
  applyLabel: string
  applyDisabled: boolean
  onApply: () => void
  /** 2段目の項目数。列数になる(幅が狭いときの折り返しは CSS が行う) */
  columns: 5 | 6
  /** 2段目の項目(BulkBarField)。確認ダイアログなど、領域の外に出すものも子として渡せる */
  children: ReactNode
}

/**
 * 一括編集バーの見た目の骨格(計画Issue #300。仕訳一覧の計画Issue #182・#280の2段構成を、明細取込と共通にする)。
 * 1段目に概要・選択解除・適用、2段目に変える項目をラベル付きで常に並べる。高さは CSS 変数 --bulk-bar-h で固定し、
 * 画面側の CSS が値と、表の見出しの複製の固定位置(--sticky-bulk-h)を同じ値から決める。
 * 項目の中身(選択欄)とルール判定、適用の処理は画面ごとに持つ。この部品は並べ方だけを決める。
 */
export function BulkBarFrame({
  ariaLabel,
  role,
  summary,
  onClearSelection,
  applyLabel,
  applyDisabled,
  onApply,
  columns,
  children,
}: BulkBarFrameProps) {
  return (
    <section aria-label={ariaLabel} role={role} className="bulk-bar">
      <div className="bulk-bar__top">
        <div className="bulk-bar__summary">{summary}</div>
        <button type="button" className="bulk-bar__button" onClick={onClearSelection}>
          選択を解除
        </button>
        <button type="button" className="bulk-bar__button bulk-bar__button--primary" disabled={applyDisabled} onClick={onApply}>
          {applyLabel}
        </button>
      </div>
      <div className={`bulk-bar__fields bulk-bar__fields--${columns}`}>{children}</div>
    </section>
  )
}

export interface BulkBarFieldProps {
  label: string
  /** 選べない理由。項目の下に1行で出す。無いときも場所は空ける(2段目の高さを変えない) */
  reason?: string
  children: ReactNode
}

/** 一括編集バーの1項目: ラベル・選択欄・理由の欄を縦に並べる */
export function BulkBarField({ label, reason, children }: BulkBarFieldProps) {
  return (
    <div className="bulk-bar__field">
      <span className="bulk-bar__label">{label}</span>
      {children}
      <span className="bulk-bar__why">{reason ?? ''}</span>
    </div>
  )
}
