import type { DeletionBlock } from '../../domain/master/summarizeMasterUsage'

/**
 * 削除できない理由の文言を作る(計画Issue #154)。理由が無ければ空文字。
 * 例: 「仕訳の明細2行、予算1件で使用中のため削除できません。無効にはできます。」
 * 文言はmaster.jsonのaccountTab.block*(参照の種類ごと)とdeleteBlockedを使う。
 */
export function describeDeletionBlocks(
  blocks: readonly DeletionBlock[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (blocks.length === 0) return ''
  const reasons = blocks
    .map((b) => t(`accountTab.block${b.source[0].toUpperCase()}${b.source.slice(1)}`, { count: b.count }))
    .join('、')
  return t('accountTab.deleteBlocked', { reasons })
}
