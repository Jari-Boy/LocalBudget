/**
 * resolveAddParentGroupId(計画Issue #257)の単体テスト。
 * マスタ画面の左上の追加ボタン(グループを追加・項目を追加)で、選んでいる行から新しい行の
 * 親グループを決める規則を検証する。外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { resolveAddParentGroupId } from './resolveAddParentGroupId'

const node = (id: string, kind: 'group' | 'leaf', parentId: string | null): TreeTableNode => ({
  id,
  kind,
  category: 'x',
  parentId,
  name: id,
  cells: [],
})

const nodes: TreeTableNode[] = [
  node('g:1', 'group', null),
  node('g:2', 'group', 'g:1'),
  node('l:10', 'leaf', 'g:2'),
  node('l:11', 'leaf', null),
]

describe('resolveAddParentGroupId', () => {
  it('何も選んでいないときは、最上位(null)に追加する', () => {
    expect(resolveAddParentGroupId(nodes, null)).toBeNull()
  })

  it('グループを選んでいるときは、そのグループの直下に追加する', () => {
    expect(resolveAddParentGroupId(nodes, 'g:2')).toBe(2)
  })

  it('最上位のグループを選んでいるときも、そのグループの直下に追加する', () => {
    expect(resolveAddParentGroupId(nodes, 'g:1')).toBe(1)
  })

  it('項目を選んでいるときは、その項目と同じグループ(兄弟)に追加する', () => {
    expect(resolveAddParentGroupId(nodes, 'l:10')).toBe(2)
  })

  it('グループに属さない最上位の項目を選んでいるときは、最上位に追加する', () => {
    expect(resolveAddParentGroupId(nodes, 'l:11')).toBeNull()
  })

  it('選んだ行が一覧に無い(削除済みなど)ときは、最上位に追加する', () => {
    expect(resolveAddParentGroupId(nodes, 'g:99')).toBeNull()
  })
})
