import './FilterToggleButton.css'

export interface FilterToggleButtonProps {
  /** 絞り込み欄が開いているか。開閉の状態は呼び出し側が持つ */
  open: boolean
  /** 適用中の条件の数。1以上なら、閉じていてもバッジで分かる */
  activeCount: number
  onToggle: () => void
  /** 開閉する絞り込み欄の id(aria-controls) */
  controlsId?: string
}

/**
 * 絞り込みの開閉ボタン(計画Issue #266)。文字は出さず、ファンネルのアイコンと適用中の条件の数のバッジだけを出す。
 * 仕訳一覧・明細取込・割勘など、絞り込み欄を持つ画面で共通に使い、見た目をそろえる。
 * 条件があるとボタンの色が変わり、バッジに数が出る。開いている間はボタンが塗りつぶされる。
 */
export function FilterToggleButton({ open, activeCount, onToggle, controlsId }: FilterToggleButtonProps) {
  const active = activeCount > 0
  const base = open ? '絞り込みを閉じる' : '絞り込みを開く'
  const label = active ? `${base}(${activeCount}件適用中)` : base
  const className = [
    'filter-toggle',
    open ? 'filter-toggle--open' : '',
    active ? 'filter-toggle--active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-expanded={open}
      aria-controls={controlsId}
      title={active ? `絞り込み中(${activeCount})` : '絞り込み'}
      onClick={onToggle}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 5h18l-7 8v6l-4 2v-8z" />
      </svg>
      {active && (
        <span className="filter-toggle__badge" data-testid="filter-toggle-badge">
          {activeCount}
        </span>
      )}
    </button>
  )
}
