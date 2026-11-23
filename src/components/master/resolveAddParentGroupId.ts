import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { parseNodeId } from './masterTreeNodes'

/**
 * 左上の追加ボタン(グループを追加・項目を追加)で作る新しい行の親グループidを、選んでいる行から決める(計画Issue #257)。
 * グループを選んでいればその直下、項目を選んでいればその兄弟(同じ親)、何も選んでいない(または一覧に無い)ときや
 * 最上位の項目を選んでいるときは最上位(null)。チェックの有無は見ない(基準は最後に選んだ行だけ)。
 */
export function resolveAddParentGroupId(nodes: readonly TreeTableNode[], selectedId: string | null): number | null {
  const selected = selectedId === null ? undefined : nodes.find((n) => n.id === selectedId)
  if (selected === undefined) return null
  if (selected.kind === 'group') return parseNodeId(selected.id).id
  return selected.parentId === null ? null : parseNodeId(selected.parentId).id
}
