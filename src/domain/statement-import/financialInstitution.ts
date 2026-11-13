/**
 * 金融機関名(import_mapping_definitions.format_group_id、計画Issue #183)の扱い。
 * 速報/確定など複数の定義が同じ金融機関に属することを表すキーなので、表記ゆれ
 * (全角半角・空白の違い)で別グループにならないよう、保存前にそろえる。
 */

/** NFKC正規化(全角英数→半角、半角カナ→全角カナ)し、空白をすべて取り除く。 */
export function normalizeFinancialInstitutionName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '')
}

/** 選択候補。正規化したうえで重複と空を除き、日本語ロケールの照合順に並べる(漢字は読み順にはならない)。 */
export function collectFinancialInstitutionNames(names: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const name of names) {
    const normalized = normalizeFinancialInstitutionName(name)
    if (normalized !== '') unique.add(normalized)
  }
  return [...unique].sort((a, b) => a.localeCompare(b, 'ja'))
}
