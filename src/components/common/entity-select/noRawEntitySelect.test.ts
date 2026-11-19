/**
 * 再発防止の構造テスト(計画Issue #233): マスタの実体(科目・取引先・プロジェクト・世帯メンバー・各グループ)を選ぶ欄に
 * 生の `<select>` を新しく足していないことを、ソースを走査して検査する。
 * 画面ごとに `<select>` を書くと、階層のインデント・検索窓・Enter確定が画面ごとにばらつくため、実体は EntitySelect(共通部品)を使う。
 * `<select>` を使ってよいのは、短い固定の選択肢(区分・はい/いいえ・文字コード等)と、下の一覧に理由つきで載せた未移行の画面だけ。
 * 一覧の件数は完全一致で比べるので、移行して減らしたら一覧も減らす(#234で未移行をすべて消す)。外部依存なし(fsでソースを読むだけ)。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..', '..')

interface Exception {
  count: number
  kind: 'fixed' | 'unmigrated'
  reason: string
}

const FIXED = 'fixed' as const
const UNMIGRATED = 'unmigrated' as const
const TODO_234 = '未移行: 実体の選択欄。#234で共通部品へ移す'

/** パス(src/からの相対、/区切り) → 許可する `<select>` の数と理由 */
const ALLOWED: Record<string, Exception> = {
  'components/analysis/AnalysisConditionBar.tsx': { count: 3, kind: FIXED, reason: '期間の月・比較方法の固定の選択肢' },
  'components/master/MappingMasterTab.tsx': { count: 7, kind: FIXED, reason: '明細定義の設定(精算区分・文字コード・区切り・日付形式・金額方式・CSV列名)の固定の選択肢' },
  'components/statement-import/MappingCreateDialog.tsx': { count: 5, kind: FIXED, reason: '明細定義の設定の固定の選択肢・CSV列名' },
  'components/master/FinancialInstitutionSelect.tsx': { count: 1, kind: FIXED, reason: '金融機関名(マスタの実体ではない文字列の候補)' },
  'components/master/RuleAmountSchedulePanel.tsx': { count: 2, kind: FIXED, reason: '仕訳の明細行番号の選択(実体ではない)' },
  'components/master/AccountCreateForm.tsx': { count: 4, kind: UNMIGRATED, reason: '区分・外部明細の有無・残高情報の有無は固定の選択肢。名義(世帯メンバー)は#234で移す' },
  'components/master/RuleEditForm.tsx': { count: 2, kind: UNMIGRATED, reason: '汎用の固定選択1つ+世帯メンバー。#234で世帯メンバーを移す' },
  'components/settlement/SplitTab.tsx': { count: 2, kind: UNMIGRATED, reason: '按分の方法は固定の選択肢。精算バッチは#234で扱いを決める' },
  'components/statement-import/StatementImportScreen.tsx': { count: 8, kind: UNMIGRATED, reason: '明細定義・科目・名義・一括/行ごとの世帯メンバー・精算バッチ・置き換え先。#234で実体ごとに移す' },
  'components/statement-import/KeywordList.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/JournalScreen.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/JournalLinesEditor.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/JournalLineTable.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/JournalLineBulkBar.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/JournalEntryEditor.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/journal-entry/RelatedEntriesSection.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/AccountMasterTab.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/AccountMergePanel.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/BulkSelectionPanel.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/CounterpartyMasterTab.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/GroupedMasterTab.tsx': { count: 1, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/KeywordBulkPanel.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
  'components/master/KeywordMasterTab.tsx': { count: 2, kind: UNMIGRATED, reason: TODO_234 },
}

/** ソースの中の生の `<select` の数 */
export function countRawSelects(source: string): number {
  return (source.match(/<select[\s>]/g) ?? []).length
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [path] : []
  })
}

describe('countRawSelects', () => {
  it('生の select の開始タグだけを数える(selectの語を含む別のタグ・文は数えない)', () => {
    expect(countRawSelects('<select value="a">\n<select>')).toBe(2)
    expect(countRawSelects('<TreeSelect label="x" />\n<EntitySelect />')).toBe(0)
  })
})

describe('マスタの実体の選択欄に、生の select を新しく足していない', () => {
  const actual = new Map(
    listSourceFiles(SRC_ROOT).flatMap((path) => {
      const count = countRawSelects(readFileSync(path, 'utf-8'))
      return count > 0 ? [[relative(SRC_ROOT, path).replaceAll(sep, '/'), count] as const] : []
    }),
  )

  it('一覧に載っていない画面には、select が無い(実体はEntitySelectを使う)', () => {
    const unlisted = [...actual.keys()].filter((path) => !(path in ALLOWED))
    expect(unlisted, `次のファイルに生のselectがあります。マスタの実体はEntitySelectを使ってください(固定の選択肢なら、理由つきでこのテストの一覧に足す): ${unlisted.join(', ')}`).toEqual([])
  })

  it('一覧のselectの数は実際と完全に一致する(移行して減らしたら一覧も減らす)', () => {
    const mismatched = Object.entries(ALLOWED)
      .filter(([path, exception]) => (actual.get(path) ?? 0) !== exception.count)
      .map(([path, exception]) => `${path}: 一覧${exception.count} / 実際${actual.get(path) ?? 0}`)
    expect(mismatched).toEqual([])
  })
})
