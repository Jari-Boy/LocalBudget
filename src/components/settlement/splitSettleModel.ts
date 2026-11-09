import type { Account } from '../../domain/account/Account'
import { hasAnySettlementActivity } from '../../domain/expense-splitting/hasAnySettlementActivity'
import { isExpenseSplittingEntrySettled } from '../../domain/expense-splitting/isExpenseSplittingEntrySettled'
import { listExpenseSplittingHistory } from '../../domain/expense-splitting/listExpenseSplittingHistory'
import { resolveExpenseSplittingParticipant } from '../../domain/expense-splitting/resolveExpenseSplittingParticipant'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { TreeSelectCategory, TreeSelectNode } from '../common/tree-select/treeSelectModel'

/**
 * 割勘・精算画面の表示用の変換(計画Issue #153)。DB・DOM非依存の純粋関数。
 */

type PartnerKind = 'householdMember' | 'counterparty'

const MEMBER_PREFIX = 'm:'
const COUNTERPARTY_PREFIX = 'c:'

function prefixItemValues(nodes: readonly TreeSelectNode[], prefix: string): TreeSelectNode[] {
  return nodes.map((node) =>
    node.kind === 'group'
      ? { ...node, children: prefixItemValues(node.children, prefix) }
      : { ...node, value: `${prefix}${node.value}` },
  )
}

/**
 * 割勘の分担相手を選ぶ選択ツリーの区分を組み立てる。世帯メンバー(m:ID)と、世帯外の相手の取引先
 * (c:ID、グループの構造は取引先のまま)を1つの木に並べる。excludedMemberIdsは選べない世帯メンバー
 * (割勘する仕訳の立替者。自分自身との割勘を防ぐ)。
 */
export function buildPartnerCategories(
  members: readonly { id: number; name: string }[],
  counterpartyCategories: readonly TreeSelectCategory[],
  excludedMemberIds: ReadonlySet<number> = new Set(),
): TreeSelectCategory[] {
  return [
    {
      key: 'member',
      name: '世帯メンバー',
      nodes: members
        .filter((m) => !excludedMemberIds.has(m.id))
        .map((m) => ({ kind: 'item' as const, value: `${MEMBER_PREFIX}${m.id}`, name: m.name, isActive: true })),
    },
    {
      key: 'counterparty',
      name: '世帯外(取引先)',
      nodes: counterpartyCategories.flatMap((c) => prefixItemValues(c.nodes, COUNTERPARTY_PREFIX)),
    },
  ]
}

/** 選択ツリーの値(m:ID / c:ID)を、分担相手の種類とIDに読む。空や不正な値は未選択(targetIdがnull) */
export function parsePartnerValue(value: string): { kind: PartnerKind; targetId: number | null } {
  const toId = (text: string) => (/^\d+$/.test(text) ? Number(text) : null)
  if (value.startsWith(MEMBER_PREFIX)) return { kind: 'householdMember', targetId: toId(value.slice(2)) }
  if (value.startsWith(COUNTERPARTY_PREFIX)) return { kind: 'counterparty', targetId: toId(value.slice(2)) }
  return { kind: 'householdMember', targetId: null }
}

/** 分担相手の種類とIDを選択ツリーの値に戻す。未選択は空文字 */
export function toPartnerValue(partner: { kind: PartnerKind; targetId: number | null }): string {
  if (partner.targetId === null) return ''
  return `${partner.kind === 'householdMember' ? MEMBER_PREFIX : COUNTERPARTY_PREFIX}${partner.targetId}`
}

export interface SplitHistoryRow {
  splitEntryId: number
  /** 元の支出のうち最も古いものの日付 */
  date: string
  /** 割勘仕訳の摘要。無ければ元の支出の摘要(複数をまとめた割勘は「N件の支出」) */
  memo: string
  /** 分担相手の名前。特定できなければ空文字 */
  partner: string
  /** 相手の負担額(立替金・未払金の行の金額) */
  amount: number
  /** 立替金・未払金の残高がすべて0 */
  isSettled: boolean
  /** 精算が1件も進んでいない(進んだ割勘は取り消せない) */
  canCancel: boolean
}

/**
 * 割勘履歴の表の行を組み立てる(計画Issue #153、旧割勘履歴画面の表示と同じ判定)。
 * 相手の負担額は、立替金(資産)の行の合計を代表にし、無ければ未払金(負債)の行の合計とする。
 * 新しい割勘が上に来るよう、割勘仕訳の取引日の降順に並べる。
 */
export function buildSplitHistoryRows(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
  members: readonly { id: number; name: string }[],
  counterparties: readonly { id: number; name: string }[],
): SplitHistoryRow[] {
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const allLines = entries.flatMap((e) => e.lines)
  const advanceLines = (split: JournalEntry, category: 'asset' | 'liability') =>
    split.lines.filter((l) => {
      const account = accountsById.get(l.accountId)
      return account?.isSystemManaged === true && account.category === category
    })

  return listExpenseSplittingHistory(entries, accounts, relatedEntryIdsByEntryId)
    .map(({ splitEntry, originalEntries }) => {
      const assetLines = advanceLines(splitEntry, 'asset')
      const amountLines = assetLines.length > 0 ? assetLines : advanceLines(splitEntry, 'liability')
      const participant = resolveExpenseSplittingParticipant(splitEntry, accounts)
      const partner =
        participant === undefined
          ? ''
          : participant.householdMemberId !== null
            ? (members.find((m) => m.id === participant.householdMemberId)?.name ?? '')
            : (counterparties.find((c) => c.id === participant.counterpartyId)?.name ?? '')
      return {
        splitEntryId: splitEntry.id,
        splitEntryDate: splitEntry.entryDate,
        date: originalEntries[0].entryDate,
        memo:
          splitEntry.memo !== null && splitEntry.memo !== ''
            ? splitEntry.memo
            : originalEntries.length === 1
              ? (originalEntries[0].memo ?? '')
              : `${originalEntries.length}件の支出`,
        partner,
        amount: amountLines.reduce((sum, l) => sum + l.amount, 0),
        isSettled: isExpenseSplittingEntrySettled(splitEntry, accounts, allLines),
        canCancel: !hasAnySettlementActivity(splitEntry, accounts, allLines),
      }
    })
    .sort((a, b) => b.splitEntryDate.localeCompare(a.splitEntryDate) || b.splitEntryId - a.splitEntryId)
    .map(({ splitEntryDate: _ignored, ...row }) => row)
}
