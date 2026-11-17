/**
 * findAccountBySystemRole の単体テスト(計画Issue #223)。
 * 科目一覧から、名前ではなく「役割」(system_role)で科目を引く純粋関数を検証する。
 * 精算画面が差額の計上先(雑収入・雑損失)を探すときに使い、科目が改名されても見つかることを保証する。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { findAccountBySystemRole } from './findAccountBySystemRole'

const accounts = [
  { id: 1, name: '食費', systemRole: null },
  { id: 2, name: 'その他の収入', systemRole: 'settlement_gain' as const },
  { id: 3, name: '雑損失', systemRole: 'settlement_loss' as const },
  { id: 4, name: '旧データの科目' },
]

describe('findAccountBySystemRole', () => {
  it('役割が一致する科目を返す(名前が既定と違っても見つかる)', () => {
    expect(findAccountBySystemRole(accounts, 'settlement_gain')?.id).toBe(2)
  })

  it('同じ役割の科目が無ければnullを返す', () => {
    expect(findAccountBySystemRole(accounts, 'balance_adjustment')).toBeNull()
  })

  it('systemRoleを持たない(undefined・null)科目はどの役割にも一致しない', () => {
    expect(findAccountBySystemRole([accounts[0], accounts[3]], 'settlement_loss')).toBeNull()
  })
})
