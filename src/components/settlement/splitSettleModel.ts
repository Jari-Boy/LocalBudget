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
