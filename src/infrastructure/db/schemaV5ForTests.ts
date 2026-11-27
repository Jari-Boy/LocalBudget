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
  const v7 = toSchemaV8(sql).replace(/-- 割勘対象行\(計画Issue #271\)[\s\S]*?prevent_change_on_expense_split_source_line[\s\S]*?END;\n\n/, '')
  if (v7.includes('expense_split_source_lines')) throw new Error('v7のDDLに割勘対象行の記述が残っている')
  return v7
}

/**
 * テスト専用: 最新のDDLから、スキーマ v9(計画Issue #249)で足した精算バッチのクローズ(is_activeの列と、
 * クローズ時の振替仕訳の表・インデックス)を取り除いて、v8 のDDLにする。v8 以前のDBを最新のDDLから作って
 * 差分を流すテストが、v9 の差分と重ならないようにするために使う。該当の記述が無いDDLには何もしない。
 */
export function toSchemaV8(sql: string): string {
  const v8 = toSchemaV11(sql)
    .replace(/ {2}-- クローズ\(計画Issue #249\)[\s\S]*?\n {2}is_active[^\n]*\n/, '')
    .replace(/-- クローズ時の振替仕訳\(計画Issue #249\)[\s\S]*?idx_settlement_batch_close_entries_entry[^\n]*\n\n/, '')
  if (v8.includes('settlement_batch_close_entries') || (v8.includes('CREATE TABLE settlement_batches') && v8.includes('is_active'))) {
    throw new Error('v8のDDLにクローズの記述が残っている')
  }
  return v8
}

/**
 * テスト専用: 最新のDDLから、スキーマ v12(計画Issue #289)で足した取込の記録の金融機関名の列(とその直前のコメント)を
 * 取り除いて、v11 のDDLにする。v11 以前のDBを最新のDDLから作って差分を流すテストが、v12 の差分(列の追加)と
 * 重ならないようにするために使う。該当の記述が無いDDLには何もしない。
 */
export function toSchemaV11(sql: string): string {
  const v11 = sql.replace(/ {2}-- 取込時の金融機関名\(計画Issue #289\)[\s\S]*?\n {2}financial_institution_name[^\n]*\n/, '')
  if (v11.includes('financial_institution_name')) throw new Error('v11のDDLに金融機関名の記述が残っている')
  return v11
}
