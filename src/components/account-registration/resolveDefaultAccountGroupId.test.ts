/**
 * resolveDefaultAccountGroupId(計画Issue #154)のテスト。
 * 科目の新規登録フォームで、区分と外部明細(CSV)の有無から、所属グループの初期選択
 * (標準グループ: 普通預金・現金・電子マネー・クレジットカード)を決める純粋関数を検証する。
 * 標準グループは通常のグループなので、改名・削除されて見つからない場合は初期選択なし(null)に
 * なること、収益・費用では初期選択しないことを確認する。DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import { resolveDefaultAccountGroupId } from './resolveDefaultAccountGroupId'

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

const groups = [
  makeGroup({ id: 1, name: '普通預金' }),
  makeGroup({ id: 2, name: '現金・電子マネー' }),
  makeGroup({ id: 3, name: 'クレジットカード', category: 'liability' }),
]

describe('resolveDefaultAccountGroupId', () => {
  it('資産で外部明細(CSV)があるときは、普通預金グループを選ぶ', () => {
    expect(resolveDefaultAccountGroupId({ category: 'asset', hasExternalStatement: true }, groups)).toBe(1)
  })

  it('資産で外部明細(CSV)がないときは、現金・電子マネーグループを選ぶ', () => {
    expect(resolveDefaultAccountGroupId({ category: 'asset', hasExternalStatement: false }, groups)).toBe(2)
  })

  it('負債のときは、外部明細の有無によらずクレジットカードグループを選ぶ', () => {
    expect(resolveDefaultAccountGroupId({ category: 'liability', hasExternalStatement: true }, groups)).toBe(3)
    expect(resolveDefaultAccountGroupId({ category: 'liability', hasExternalStatement: false }, groups)).toBe(3)
  })

  it('収益・費用のときは、初期選択しない', () => {
    expect(resolveDefaultAccountGroupId({ category: 'expense', hasExternalStatement: false }, groups)).toBeNull()
    expect(resolveDefaultAccountGroupId({ category: 'revenue', hasExternalStatement: false }, groups)).toBeNull()
  })

  it('標準グループが改名・削除されて見つからないときは、初期選択しない', () => {
    const renamed = [makeGroup({ id: 1, name: 'メイン口座' })]

    expect(resolveDefaultAccountGroupId({ category: 'asset', hasExternalStatement: true }, renamed)).toBeNull()
  })

  it('最上位でないグループや無効なグループは選ばない', () => {
    const others = [
      makeGroup({ id: 1, name: '普通預金', parentGroupId: 9 }),
      makeGroup({ id: 2, name: '普通預金', isActive: false }),
    ]

    expect(resolveDefaultAccountGroupId({ category: 'asset', hasExternalStatement: true }, others)).toBeNull()
  })

  it('同じ名前でも区分が違うグループは選ばない', () => {
    const wrongCategory = [makeGroup({ id: 3, name: 'クレジットカード', category: 'asset' })]

    expect(
      resolveDefaultAccountGroupId({ category: 'liability', hasExternalStatement: true }, wrongCategory),
    ).toBeNull()
  })
})
