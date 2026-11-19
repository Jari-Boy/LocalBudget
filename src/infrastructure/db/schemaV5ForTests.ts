/**
 * テスト専用: 最新のDDLから、スキーマ v6(計画Issue #231 フェーズ4)で足したお気に入りの列(とその直前のコメント)と、
 * システム管理科目のトリガーの1行を取り除いて、v5 以前のDDLにする。古いバージョンのDBを最新のDDLから作って
 * 差分を流すテストが、v6 の差分(列の追加)と重ならないようにするために使う。お気に入りの記述が無いDDLには何もしない。
 */
export function toSchemaV5(sql: string): string {
  const v5 = sql
    .replace(/ {2}-- お気に入り[\s\S]*?\n {2}is_favorite[^\n]*\n/, '')
    .replace(/ {4}NEW\.is_favorite IS NOT OLD\.is_favorite OR\n/, '')
  if (v5.includes('is_favorite')) throw new Error('v5のDDLにお気に入りの記述が残っている')
  return v5
}
