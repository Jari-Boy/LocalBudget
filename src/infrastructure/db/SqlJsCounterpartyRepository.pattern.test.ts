/**
 * SqlJsCounterpartyRepository のパターン管理機能(addPattern/findByPattern)の統合テスト。
 * docs/domain/counterparties.md 1.3に定義された、CSV摘要文字列と登録済みパターンとの
 * 部分一致マッチング(LIKE '%pattern%')が期待通り機能することを検証する。
 * 基本CRUDは SqlJsCounterpartyRepository.test.ts、統合(merge)は
 * SqlJsCounterpartyRepository.merge.test.ts で扱う。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'

let db: Database
let repository: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsCounterpartyRepository(db)
})

describe('addPattern', () => {
  it('取引先にパターンを追加する', () => {
    const counterparty = repository.create({ name: 'イオン' })

    const pattern = repository.addPattern(counterparty.id, 'AEON')

    expect(pattern).toMatchObject({
      counterpartyId: counterparty.id,
      pattern: 'AEON',
    })
  })
})

describe('findByPattern', () => {
  it('登録済みパターンがCSV摘要文字列に部分一致する場合、そのパターンを返す', () => {
    const counterparty = repository.create({ name: 'Amazon' })
    repository.addPattern(counterparty.id, 'AMAZON')

    const matches = repository.findByPattern('AMAZON CO JP TOKYO')

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ counterpartyId: counterparty.id, pattern: 'AMAZON' })
  })

  it('部分一致しない場合は空配列を返す', () => {
    const counterparty = repository.create({ name: 'Amazon' })
    repository.addPattern(counterparty.id, 'AMAZON')

    const matches = repository.findByPattern('イオン○○店')

    expect(matches).toEqual([])
  })

  it('複数の取引先パターンに一致する場合は複数件返す(曖昧マッチ、確定はユーザーに委ねる)', () => {
    const aeon = repository.create({ name: 'イオン' })
    const aeonMall = repository.create({ name: 'イオンモール' })
    repository.addPattern(aeon.id, 'イオン')
    repository.addPattern(aeonMall.id, 'イオンモール')

    const matches = repository.findByPattern('イオンモール○○店')

    expect(matches).toHaveLength(2)
  })
})
