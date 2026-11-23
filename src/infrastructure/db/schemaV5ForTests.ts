/**
 * テスト専用: 最新のDDLから、スキーマ v6(計画Issue #231 フェーズ4)で足したお気に入りの列(とその直前のコメント)と、
 * システム管理科目のトリガーの1行を取り除いて、v5 以前のDDLにする。古いバージョンのDBを最新のDDLから作って
 * 差分を流すテストが、v6 の差分(列の追加)と重ならないようにするために使う。お気に入りの記述が無いDDLには何もしない。
 * v8 以降で足したもの(toSchemaV7が取り除く)も取り除く。
 */
export function toSchemaV5(sql: string): string {
  const v5 = toSchemaV7(sql)
    .replace(/ {2}-- お気に入り[\s\S]*?\n {2}is_favorite[^\n]*\n/, '')
    .replace(/ {4}NEW\.is_favorite IS NOT OLD\.is_favorite OR\n/, '')
  if (v5.includes('is_favorite')) throw new Error('v5のDDLにお気に入りの記述が残っている')
  return v5
}

/**
 * テスト専用: 最新のDDLから、スキーマ v8(計画Issue #271)で足した割勘対象行の表・インデックス・トリガーを取り除いて、
 * v7 のDDLにする。v7 以前のDBを最新のDDLから作って差分を流すテストが、v8 の差分(表の追加)と重ならないようにするために使う。
 * 該当の記述が無いDDLには何もしない。
 */
export function toSchemaV7(sql: string): string {
  const v7 = sql.replace(/-- 割勘対象行\(計画Issue #271\)[\s\S]*?prevent_change_on_expense_split_source_line[\s\S]*?END;\n\n/, '')
  if (v7.includes('expense_split_source_lines')) throw new Error('v7のDDLに割勘対象行の記述が残っている')
  return v7
}
