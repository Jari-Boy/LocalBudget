/**
 * サイドナビの5領域と、領域内のタブ(旧ハブ画面の入口)の定義(計画Issue #150)。
 * 各領域は「入口のパス」と、その領域に属するパスの接頭辞(prefixes)を持つ。
 * 定期取引のルールはマスタ領域のタブ(/master/recurring)に置き、提案の確認は仕訳画面内のタブに置く
 * (計画Issue #154で、ルールの画面を旧/journal/recurring/rulesからマスタ配下へ移した)。
 * 設定(計画Issue #173)は日々の記帳の領域ではないため、区切り線の後ろ(サイドナビの一番下)に置く。
 */
export type AreaKey = 'journal' | 'master' | 'import' | 'split' | 'analysis' | 'settings'

export interface AreaTab {
  /** common.jsonのnav.tab.*のキー */
  labelKey: string
  to: string
}

export interface Area {
  key: AreaKey
  to: string
  prefixes: string[]
  tabs: AreaTab[]
  /** trueなら区切り線の後ろ(サイドナビの一番下)に置く */
  separated?: boolean
}

/** サイドナビの並び順は、仕訳・マスタ・明細取込・割勘・精算・分析、区切って設定。 */
export const AREAS: Area[] = [
  // 仕訳領域の「仕訳一覧」「下書き」「定期の確認」は、画面内のタブにした(計画Issue #152)
  { key: 'journal', to: '/journal/entries', prefixes: ['/journal/entries'], tabs: [] },
  {
    key: 'master',
    to: '/master/accounts',
    prefixes: ['/master'],
    tabs: [
      { labelKey: 'accounts', to: '/master/accounts' },
      { labelKey: 'counterparties', to: '/master/counterparties' },
      { labelKey: 'householdMembers', to: '/master/household-members' },
      { labelKey: 'projects', to: '/master/projects' },
      { labelKey: 'recurringRules', to: '/master/recurring' },
      { labelKey: 'mappings', to: '/master/mappings' },
    ],
  },
  { key: 'import', to: '/journal/create/import', prefixes: ['/journal/create/import'], tabs: [] },
  // 割勘・精算の「割勘」「精算」は、画面内のタブにした(計画Issue #153)
  { key: 'split', to: '/journal/splitting', prefixes: ['/journal/splitting'], tabs: [] },
  { key: 'analysis', to: '/reports/analysis', prefixes: ['/reports'], tabs: [] },
  { key: 'settings', to: '/settings', prefixes: ['/settings'], tabs: [], separated: true },
]

/** パスが接頭辞(セグメント境界で)に一致するか。 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** 現在のパスが属する領域。どれにも属さなければundefined。 */
export function findArea(pathname: string): Area | undefined {
  return AREAS.find((area) => area.prefixes.some((p) => matchesPrefix(pathname, p)))
}

/** 領域内で現在のパスに対応するタブ(最長一致)。 */
export function findActiveTab(area: Area, pathname: string): AreaTab | undefined {
  return area.tabs
    .filter((tab) => matchesPrefix(pathname, tab.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
}
