import type { JournalEntry, JournalEntrySourceType, JournalLine, JournalLineSide } from '../../../domain/journal/JournalEntry'

/**
 * 仕訳の結果一覧の1行要約を作る純粋関数と、出どころタグの定義(計画Issue #150)。
 * DB・DOM非依存。科目名の解決は呼び出し側が渡す関数に任せ、ドメインのRepositoryに依存しない。
 */

/** 色はデザイントークン(tokens.css)のCSSカスタムプロパティ名。 */
export interface SourceTag {
  label: string
  bg: string
  fg: string
}

const BLUE = { bg: 'var(--color-tag-blue-bg)', fg: 'var(--color-tag-blue-text)' }
const NEUTRAL = { bg: 'var(--color-tag-neutral-bg)', fg: 'var(--color-tag-neutral-text)' }
const ORANGE = { bg: 'var(--color-tag-orange-bg)', fg: 'var(--color-tag-orange-text)' }
const PURPLE = { bg: 'var(--color-tag-purple-bg)', fg: 'var(--color-tag-purple-text)' }
const YELLOW = { bg: 'var(--color-tag-yellow-bg)', fg: 'var(--color-tag-yellow-text)' }

/** 仕訳の出どころ(作成経路)ごとのタグ。下書きは確定前の別状態なので別に持つ。 */
export const SOURCE_TAGS: Record<JournalEntrySourceType, SourceTag> = {
  external_import: { label: '外部明細', ...BLUE },
  manual: { label: '手入力', ...NEUTRAL },
  expense_splitting: { label: '割勘', ...ORANGE },
  recurring_generated: { label: '定期', ...PURPLE },
  initial_balance: { label: '初期残高', ...NEUTRAL },
  balance_adjustment: { label: '残高調整', ...NEUTRAL },
}

export const DRAFT_TAG: SourceTag = { label: '下書き', ...YELLOW }

export interface JournalResultItem {
  id: number
  /** 'draft'は未確定の下書き(確定済みの仕訳の作成経路とは別) */
  sourceType: JournalEntrySourceType | 'draft'
  memo: string
  amount: number
  currency: string
  /** YYYY-MM-DD */
  entryDate: string
  debitSummary: string
  creditSummary: string
  /** 日付のあとに添える補足(計画Issue #164。承認待ちの定期仕訳の「期日 10/25 を前の平日に」など) */
  note?: string
}

const NO_MEMO = '(摘要なし)'
const NO_ACCOUNT = '未選択'

/**
 * 片側の代表科目(金額が最大の明細行)と残り件数を要約する。絞り込み中は
 * 一致した明細行(matchAccountIds)を優先して代表にする。
 */
export function summarizeSide(
  lines: readonly JournalLine[],
  side: JournalLineSide,
  accountNameOf: (accountId: number) => string,
  matchAccountIds?: ReadonlySet<number>,
): string {
  const all = lines.filter((line) => line.side === side)
  if (all.length === 0) return NO_ACCOUNT
  const hit = matchAccountIds ? all.filter((line) => matchAccountIds.has(line.accountId)) : []
  const candidates = hit.length > 0 ? hit : all
  const representative = candidates.reduce((best, line) => (line.amount > best.amount ? line : best))
  const name = accountNameOf(representative.accountId)
  return all.length > 1 ? `${name} ほか${all.length - 1}件` : name
}

export function toJournalResultItem(
  entry: JournalEntry,
  accountNameOf: (accountId: number) => string,
  matchAccountIds?: ReadonlySet<number>,
): JournalResultItem {
  return {
    id: entry.id,
    sourceType: entry.sourceType,
    memo: entry.memo && entry.memo !== '' ? entry.memo : NO_MEMO,
    amount: entry.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0),
    currency: entry.currency,
    entryDate: entry.entryDate,
    debitSummary: summarizeSide(entry.lines, 'debit', accountNameOf, matchAccountIds),
    creditSummary: summarizeSide(entry.lines, 'credit', accountNameOf, matchAccountIds),
  }
}
