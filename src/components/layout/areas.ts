/**
 * サイドナビの5領域と、領域内のタブ(旧ハブ画面の入口)の定義(計画Issue #150)。
 * 各領域は「入口のパス」と、その領域に属するパスの接頭辞(prefixes)を持つ。
 * 定期取引ルールは画面の配置が/journal/recurring配下だが、ユーザー決定により
 * マスタ領域のタブに置く(提案の確認は仕訳領域のタブ)。
 */
export type AreaKey = 'import' | 'journal' | 'split' | 'master' | 'analysis'

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
}

export const AREAS: Area[] = [
  { key: 'import', to: '/journal/create/import', prefixes: ['/journal/create/import'], tabs: [] },
  {
    key: 'journal',
    to: '/journal/entries',
    prefixes: ['/journal/entries', '/journal/create/manual', '/journal/recurring/proposals'],
    tabs: [
      { labelKey: 'entries', to: '/journal/entries' },
      { labelKey: 'manualEntry', to: '/journal/create/manual' },
      { labelKey: 'proposals', to: '/journal/recurring/proposals' },
    ],
  },
  {
    key: 'split',
    to: '/journal/splitting/new',
    prefixes: ['/journal/splitting'],
    tabs: [
      { labelKey: 'newSplit', to: '/journal/splitting/new' },
      { labelKey: 'settlement', to: '/journal/splitting/settlement' },
      { labelKey: 'splitHistory', to: '/journal/splitting/history' },
    ],
  },
  {
    key: 'master',
    to: '/master/accounts/list',
    prefixes: ['/master', '/journal/recurring/rules'],
    tabs: [
      { labelKey: 'accountList', to: '/master/accounts/list' },
      { labelKey: 'accountNew', to: '/master/accounts/new' },
      { labelKey: 'accountGroups', to: '/master/accounts/groups' },
      { labelKey: 'counterparties', to: '/master/counterparties' },
      { labelKey: 'householdMembers', to: '/master/household-members' },
      { labelKey: 'projects', to: '/master/projects' },
      { labelKey: 'recurringRules', to: '/journal/recurring/rules' },
    ],
  },
  { key: 'analysis', to: '/reports/financial-statements', prefixes: ['/reports'], tabs: [] },
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
