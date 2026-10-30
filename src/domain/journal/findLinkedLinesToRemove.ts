import type { JournalEntry, JournalLine } from './JournalEntry'
import type { JournalEntryLink } from './JournalEntryLink'

export interface LinkedLineToRemove {
  line: JournalLine
  /** その行がfrom_line・to_lineのいずれかになっているリンク(削除時にON DELETE CASCADEで一緒に消える) */
  links: JournalEntryLink[]
}

/**
 * 仕訳の更新で削除される明細行のうち、リンクが付いているものを返す(計画Issue #132)。
 * 更新(JournalEntryRepository.update)は行idによる差分更新のため、入力から消えた既存行は
 * DELETEされ、その行のjournal_entry_linksもカスケード削除される。docs/domain/settlement.md 1.8の
 * 「編集は妨げない」方針に合わせ、削除自体は拒否せず、画面が保存前に警告するための判定を行う。
 * keptLineIdsは更新後も残す(=更新入力にidが含まれる)既存行のid。linksは
 * JournalEntryRepository.listLinksForEntryの返り値をそのまま渡せる。DB非依存の純粋関数。
 */
export function findLinkedLinesToRemove(
  entry: JournalEntry,
  keptLineIds: ReadonlySet<number>,
  links: readonly JournalEntryLink[],
): LinkedLineToRemove[] {
  return entry.lines
    .filter((line) => !keptLineIds.has(line.id))
    .map((line) => ({
      line,
      links: links.filter((link) => link.fromLineId === line.id || link.toLineId === line.id),
    }))
    .filter(({ links: linkedLinks }) => linkedLinks.length > 0)
}
