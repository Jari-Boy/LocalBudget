/**
 * resolveAccountGroupDrop(計画Issue #129)のテスト。
 * 勘定科目グループ管理画面のドラッグ&ドロップ(3ゾーン方式: 行の上端/下端=兄弟として
 * 挿入、中央=子としてネスト)の結果、どのグループ・科目のparentGroupId/accountGroupId・
 * sortOrderを更新すべきかを判定する純粋関数を検証する。DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { AccountGroup } from './AccountGroup'
import { resolveAccountGroupDrop } from './resolveAccountGroupDrop'

function makeGroup(overrides: Partial<AccountGroup> & Pick<AccountGroup, 'id' | 'name'>): AccountGroup {
  return {
    parentGroupId: null,
    category: 'asset',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    category: 'asset',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveAccountGroupDrop', () => {
  it('categoryが異なるグループ同士のネスト(中央)は拒否される(null)', () => {
    const dragged = makeGroup({ id: 1, name: '現金同等物', category: 'asset' })
    const target = makeGroup({ id: 2, name: 'クレカ', category: 'liability' })

    const result = resolveAccountGroupDrop([dragged, target], [], { kind: 'group', id: 1 }, {
      kind: 'group',
      id: 2,
      zone: 'inside',
    })

    expect(result).toBeNull()
  })

  it('categoryが異なる科目のグループへのネストは拒否される(null)', () => {
    const account = makeAccount({ id: 101, name: '普通預金', category: 'asset' })
    const group = makeGroup({ id: 1, name: 'クレカ', category: 'liability' })

    const result = resolveAccountGroupDrop([group], [account], { kind: 'account', id: 101 }, {
      kind: 'group',
      id: 1,
      zone: 'inside',
    })

    expect(result).toBeNull()
  })

  it('自分自身への中央ドロップ(自己ネスト)は拒否される(null)', () => {
    const group = makeGroup({ id: 1, name: '現金同等物' })

    const result = resolveAccountGroupDrop([group], [], { kind: 'group', id: 1 }, {
      kind: 'group',
      id: 1,
      zone: 'inside',
    })

    expect(result).toBeNull()
  })

  it('自分の子孫への中央ドロップ(循環参照)は拒否される(null)', () => {
    const parent = makeGroup({ id: 1, name: '固定費', category: 'expense' })
    const child = makeGroup({ id: 2, name: 'カード', category: 'expense', parentGroupId: 1 })

    const result = resolveAccountGroupDrop([parent, child], [], { kind: 'group', id: 1 }, {
      kind: 'group',
      id: 2,
      zone: 'inside',
    })

    expect(result).toBeNull()
  })

  it('自分の子孫を親とする兄弟挿入(循環参照)も拒否される(null)', () => {
    const parent = makeGroup({ id: 1, name: '固定費', category: 'expense' })
    const child = makeGroup({ id: 2, name: 'カード', category: 'expense', parentGroupId: 1 })
    const grandchild = makeGroup({ id: 3, name: '楽天カード', category: 'expense', parentGroupId: 2 })

    // parent(1)をgrandchild(3、2の子)の兄弟として挿入しようとすると、
    // 挿入先コンテナ(2)が1の子孫になり循環参照になる
    const result = resolveAccountGroupDrop([parent, child, grandchild], [], { kind: 'group', id: 1 }, {
      kind: 'group',
      id: 3,
      zone: 'before',
    })

    expect(result).toBeNull()
  })

  it('未分類の科目を最上位グループの兄弟として挿入すると、未分類のまま並び順だけ変わる', () => {
    const account = makeAccount({ id: 101, name: '普通預金', accountGroupId: null, sortOrder: 5 })
    const rootGroup = makeGroup({ id: 1, name: '現金同等物', sortOrder: 0 })

    const result = resolveAccountGroupDrop([rootGroup], [account], { kind: 'account', id: 101 }, {
      kind: 'group',
      id: 1,
      zone: 'before',
    })

    expect(result).not.toBeNull()
    expect(result!.accountUpdates.get(101)).not.toHaveProperty('accountGroupId')
    expect(result!.accountUpdates.get(101)?.sortOrder).toBeDefined()
  })

  it('グループに属する科目を、未分類の科目の手前へ兄弟挿入すると、未分類に戻りその位置に並ぶ', () => {
    const group = makeGroup({ id: 1, name: '現金同等物' })
    const grouped = makeAccount({ id: 101, name: '証券口座', accountGroupId: 1 })
    const unclassified = makeAccount({ id: 102, name: '未分類の口座', accountGroupId: null, sortOrder: 0 })

    const result = resolveAccountGroupDrop(
      [group],
      [grouped, unclassified],
      { kind: 'account', id: 101 },
      { kind: 'account', id: 102, zone: 'before' },
    )

    expect(result).not.toBeNull()
    expect(result!.accountUpdates.get(101)).toMatchObject({ accountGroupId: null })
  })

  it('categoryが異なる未分類の科目同士は、それぞれの入れ物が独立している', () => {
    const assetUnclassified = makeAccount({ id: 101, name: '資産の未分類', category: 'asset', sortOrder: 0 })
    const liabilityUnclassified = makeAccount({
      id: 102,
      name: '負債の未分類',
      category: 'liability',
      sortOrder: 0,
    })

    const result = resolveAccountGroupDrop(
      [],
      [assetUnclassified, liabilityUnclassified],
      { kind: 'account', id: 101 },
      { kind: 'account', id: 102, zone: 'before' },
    )

    expect(result).toBeNull()
  })

  it('有効な中央ドロップ(ネスト)では、draggedの親が変わり末尾に追加される', () => {
    const dragged = makeGroup({ id: 2, name: 'ネット銀行', category: 'asset' })
    const target = makeGroup({ id: 1, name: '現金同等物', category: 'asset' })
    const existingChild = makeAccount({ id: 101, name: '現金', accountGroupId: 1, sortOrder: 0 })

    const result = resolveAccountGroupDrop(
      [dragged, target],
      [existingChild],
      { kind: 'group', id: 2 },
      { kind: 'group', id: 1, zone: 'inside' },
    )

    expect(result).not.toBeNull()
    expect(result!.groupUpdates.get(2)).toMatchObject({ parentGroupId: 1 })
    expect(result!.groupUpdates.get(2)!.sortOrder).toBeGreaterThan(0)
  })

  it('有効な兄弟挿入(before)では、同じ入れ物の全員にsortOrderが再採番される', () => {
    const a = makeGroup({ id: 1, name: 'A', sortOrder: 0 })
    const b = makeGroup({ id: 2, name: 'B', sortOrder: 1 })
    const c = makeGroup({ id: 3, name: 'C', sortOrder: 2 })
    // Cを先頭(Aの手前)へ移動する
    const result = resolveAccountGroupDrop([a, b, c], [], { kind: 'group', id: 3 }, {
      kind: 'group',
      id: 1,
      zone: 'before',
    })

    expect(result).not.toBeNull()
    const order = [...result!.groupUpdates.entries()]
      .filter(([, update]) => update.sortOrder !== undefined)
      .sort(([, x], [, y]) => x.sortOrder! - y.sortOrder!)
      .map(([id]) => id)
    // Cが最初に来る(A, Bがそれに続く)よう並び変わっていること
    expect(order[0]).toBe(3)
  })

  it('科目とグループが混在した兄弟挿入(科目をグループの手前に挿入)ができる', () => {
    const parent = makeGroup({ id: 1, name: '現金同等物' })
    const subGroup = makeGroup({ id: 2, name: 'ネット銀行', parentGroupId: 1, sortOrder: 0 })
    const account = makeAccount({ id: 101, name: '現金', accountGroupId: 1, sortOrder: 1 })
    const otherAccount = makeAccount({ id: 102, name: '普通預金', accountGroupId: 1, sortOrder: 2 })

    // otherAccount(102)をsubGroup(2)の手前へ移動する
    const result = resolveAccountGroupDrop(
      [parent, subGroup],
      [account, otherAccount],
      { kind: 'account', id: 102 },
      { kind: 'group', id: 2, zone: 'before' },
    )

    expect(result).not.toBeNull()
    expect(result!.accountUpdates.get(102)?.sortOrder).toBeLessThan(result!.groupUpdates.get(2)!.sortOrder!)
  })

  it('異なる親への兄弟挿入(階層移動)では、draggedのparentGroupIdが新しい入れ物に変わる', () => {
    const oldParent = makeGroup({ id: 1, name: '固定費', category: 'expense' })
    const newParent = makeGroup({ id: 2, name: '変動費', category: 'expense' })
    const dragged = makeGroup({ id: 3, name: 'サブ', category: 'expense', parentGroupId: 1 })
    const destSibling = makeGroup({ id: 4, name: '既存の子', category: 'expense', parentGroupId: 2 })

    const result = resolveAccountGroupDrop(
      [oldParent, newParent, dragged, destSibling],
      [],
      { kind: 'group', id: 3 },
      { kind: 'group', id: 4, zone: 'after' },
    )

    expect(result).not.toBeNull()
    expect(result!.groupUpdates.get(3)).toMatchObject({ parentGroupId: 2 })
  })

  it('最上位グループの兄弟挿入(ルートレベル)では入れ物がcategoryで絞り込まれる', () => {
    const assetRoot1 = makeGroup({ id: 1, name: '現金同等物', category: 'asset', sortOrder: 0 })
    const assetRoot2 = makeGroup({ id: 2, name: '住居', category: 'asset', sortOrder: 1 })
    const liabilityRoot = makeGroup({ id: 3, name: 'クレカ', category: 'liability', sortOrder: 0 })

    const result = resolveAccountGroupDrop(
      [assetRoot1, assetRoot2, liabilityRoot],
      [],
      { kind: 'group', id: 2 },
      { kind: 'group', id: 1, zone: 'before' },
    )

    expect(result).not.toBeNull()
    // liability側のグループは更新対象に含まれない(別の入れ物のため無関係)
    expect(result!.groupUpdates.has(3)).toBe(false)
  })

  it('自分自身への兄弟挿入(no-op)は拒否される(null)', () => {
    const group = makeGroup({ id: 1, name: 'A' })

    const result = resolveAccountGroupDrop([group], [], { kind: 'group', id: 1 }, {
      kind: 'group',
      id: 1,
      zone: 'before',
    })

    expect(result).toBeNull()
  })

  it('既に正しい位置にある場合は変更なし(空のMap)を返す', () => {
    const a = makeGroup({ id: 1, name: 'A', sortOrder: 0 })
    const b = makeGroup({ id: 2, name: 'B', sortOrder: 1 })
    // Bをすでに自分の直後にいるAの「後ろ」へ挿入 = 実質的に現状維持
    const result = resolveAccountGroupDrop([a, b], [], { kind: 'group', id: 2 }, {
      kind: 'group',
      id: 1,
      zone: 'after',
    })

    expect(result).not.toBeNull()
    expect(result!.groupUpdates.size).toBe(0)
    expect(result!.accountUpdates.size).toBe(0)
  })
})
