/**
 * 一覧画面の行内操作ボタン(編集・削除・非アクティブ化)で共通利用するアイコン(計画Issue #127)。
 * ボタンの視覚的な見た目を仕訳Linesテーブル(JournalEntryLinesTable)の削除アイコンと揃えるために
 * 切り出した。各アイコンは装飾専用であり、意味はボタン側のaria-labelが担うため、
 * アイコン自体は常にaria-hidden="true"とする(ロジックを持たない純粋なマークアップ)。
 */
const baseSvgProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const EditIcon = () => (
  <svg {...baseSvgProps}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
  </svg>
)

export const TrashIcon = () => (
  <svg {...baseSvgProps}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>
)

export const EyeIcon = () => (
  <svg {...baseSvgProps}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
)

export const EyeOffIcon = () => (
  <svg {...baseSvgProps}>
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
)

/** 行の展開/折りたたみ(内訳表示等)トグル用。aria-expandedに応じて呼び出し側のCSSで回転させる想定 */
export const ChevronDownIcon = () => (
  <svg {...baseSvgProps}>
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
)
