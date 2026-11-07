/**
 * 既定の名前でマスタ項目を作るとき、既存の名前と重ならない名前を返す(計画Issue #154)。
 * 同じ名前があれば末尾に「 2」「 3」…と連番を付ける。
 */
export function uniqueName(base: string, existing: readonly string[]): string {
  const used = new Set(existing)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}
