/**
 * SqlJsAccountRepository のシステム役割(system_role、計画Issue #223)の統合テスト。
 * 科目を名前ではなく役割(精算の差益・精算の差損・残高調整)で識別するための列について、
 * 作成・読み出し・DDLの制約(システム管理科目だけが持てる・区分と合う・同じ役割は1件・付与後は変更不可)と、
 * 名前の変更だけは許され、削除・統合は拒否されることを検証する。外部依存: sql.js のみ。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

function createGain(name = '雑収入') {
  return repository.create({
    category: 'revenue',
    name,
    isReconcilable: null,
    isSystemManaged: true,
    systemRole: 'settlement_gain',
  })
}

describe('system_roleの作成と読み出し', () => {
  it('役割を指定して作成した科目は、読み出してもsystemRoleが保たれる', () => {
    const created = createGain()

    expect(repository.findById(created.id)?.systemRole).toBe('settlement_gain')
  })

  it('役割を指定しない科目のsystemRoleはnullになる', () => {
    const created = repository.create({ category: 'expense', name: '食費', isReconcilable: null })

    expect(created.systemRole).toBeNull()
  })
})

describe('system_roleのDDL制約', () => {
  it('システム管理でない科目に役割を付けるとDBが拒否する', () => {
    expect(() =>
      repository.create({
        category: 'revenue',
        name: '雑収入',
        isReconcilable: null,
        isSystemManaged: false,
        systemRole: 'settlement_gain',
      }),
    ).toThrow()
  })

  it('役割と区分が合わない科目(差益を費用科目に付ける等)はDBが拒否する', () => {
    expect(() =>
      repository.create({
        category: 'expense',
        name: '雑収入',
        isReconcilable: null,
        isSystemManaged: true,
        systemRole: 'settlement_gain',
      }),
    ).toThrow()
  })

  it('同じ役割の科目を2件作ろうとするとDBが拒否する', () => {
    createGain('雑収入')

    expect(() => createGain('別の差益')).toThrow()
  })

  it('費用の「残高調整」と「雑損失」は、どちらもシステム管理の費用科目として共存できる', () => {
    repository.create({
      category: 'expense',
      name: '残高調整',
      isReconcilable: null,
      isSystemManaged: true,
      systemRole: 'balance_adjustment',
    })

    expect(() =>
      repository.create({
        category: 'expense',
        name: '雑損失',
        isReconcilable: null,
        isSystemManaged: true,
        systemRole: 'settlement_loss',
      }),
    ).not.toThrow()
  })
})

describe('役割を持つ科目の保護', () => {
  it('名前の変更は許され、役割は変わらない(改名しても役割で見つかる)', () => {
    const created = createGain()

    const renamed = repository.update(created.id, { name: 'その他の収入' })

    expect(renamed.name).toBe('その他の収入')
    expect(renamed.systemRole).toBe('settlement_gain')
  })

  it('付与済みの役割は後から書き換えられない', () => {
    const created = createGain()

    expect(() => db.run('UPDATE accounts SET system_role = NULL WHERE id = ?', [created.id])).toThrow()
    expect(() => db.run("UPDATE accounts SET system_role = 'balance_adjustment' WHERE id = ?", [created.id])).toThrow()
  })

  it('削除は拒否される', () => {
    const created = createGain()

    expect(() => repository.delete(created.id)).toThrow()
  })

  it('他の科目への統合の元にも先にもできない', () => {
    const gain = createGain()
    const other = repository.create({ category: 'revenue', name: '給与', isReconcilable: null })

    expect(() => repository.merge(other.id, [gain.id])).toThrow()
    expect(() => repository.merge(gain.id, [other.id])).toThrow()
  })
})
