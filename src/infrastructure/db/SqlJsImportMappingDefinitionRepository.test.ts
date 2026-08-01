/**
 * SqlJsImportMappingDefinitionRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/statement-import.md 2章・
 * docs/schema/statement_import.sql に定義されたマッピング定義(import_mapping_definitions)の
 * 作成・参照・更新・削除、amount_modeに応じた列指定の整合性を強制するDDL側CHECK制約との連携、
 * accountIdに紐づく専用定義+汎用定義(account_id IS NULL)をあわせて返すfindAvailableForAccountを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsImportMappingDefinitionRepository } from './SqlJsImportMappingDefinitionRepository'

let db: Database
let repository: SqlJsImportMappingDefinitionRepository
let bankAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsImportMappingDefinitionRepository(db)

  bankAccountId = accounts.create({
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
  }).id
})

describe('create / findById', () => {
  it('single_signed形式の定義を作成しidで参照できる', () => {
    const created = repository.create({
      formatGroupId: 'my-bank',
      label: 'マイ銀行 普通預金',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    const found = repository.findById(created.id)

    expect(found?.formatGroupId).toBe('my-bank')
    expect(found?.label).toBe('マイ銀行 普通預金')
    expect(found?.amountMode).toBe('single_signed')
    expect(found?.amountColumn).toBe('2')
    expect(found?.debitColumn).toBeNull()
    expect(found?.creditColumn).toBeNull()
    expect(found?.accountId).toBeNull()
    expect(found?.encoding).toBe('utf-8')
    expect(found?.delimiter).toBe(',')
    expect(found?.headerRowCount).toBe(1)
  })

  it('debit_credit_split形式の定義を作成しidで参照できる', () => {
    const created = repository.create({
      accountId: bankAccountId,
      formatGroupId: 'rakuten-card',
      label: '楽天カード(確定明細)',
      isSettled: true,
      encoding: 'shift-jis',
      dateColumn: '利用日',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '利用店名',
      amountMode: 'debit_credit_split',
      debitColumn: '出金額',
      creditColumn: '入金額',
      balanceColumn: '残高',
      externalIdColumn: '管理番号',
    })

    const found = repository.findById(created.id)

    expect(found?.accountId).toBe(bankAccountId)
    expect(found?.amountMode).toBe('debit_credit_split')
    expect(found?.debitColumn).toBe('出金額')
    expect(found?.creditColumn).toBe('入金額')
    expect(found?.amountColumn).toBeNull()
    expect(found?.isSettled).toBe(true)
    expect(found?.encoding).toBe('shift-jis')
    expect(found?.balanceColumn).toBe('残高')
    expect(found?.externalIdColumn).toBe('管理番号')
  })

  it('amount_modeとcolumnの組み合わせがDDLのCHECK制約に違反する場合は例外を伝播する', () => {
    expect(() =>
      repository.create({
        formatGroupId: 'broken',
        label: '壊れた定義',
        dateColumn: '0',
        dateFormat: 'YYYY/MM/DD',
        descriptionColumn: '1',
        amountMode: 'single_signed',
        amountColumn: null,
      }),
    ).toThrow()
  })

  it('存在しないidの場合はnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した定義をすべてid順に返す', () => {
    repository.create({
      formatGroupId: 'bank-a',
      label: '銀行A',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })
    repository.create({
      formatGroupId: 'bank-b',
      label: '銀行B',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    const all = repository.findAll()

    expect(all).toHaveLength(2)
    expect(all[0].label).toBe('銀行A')
    expect(all[1].label).toBe('銀行B')
  })
})

describe('update', () => {
  it('labelとaccountIdを更新できる', () => {
    const created = repository.create({
      formatGroupId: 'my-bank',
      label: '仮ラベル',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    const updated = repository.update(created.id, {
      label: '確定ラベル',
      accountId: bankAccountId,
    })

    expect(updated.label).toBe('確定ラベル')
    expect(updated.accountId).toBe(bankAccountId)
    expect(updated.formatGroupId).toBe('my-bank')
  })

  it('存在しないidの場合は例外を投げる', () => {
    expect(() => repository.update(9999, { label: 'x' })).toThrow()
  })
})

describe('delete', () => {
  it('定義を削除するとfindByIdでnullになる', () => {
    const created = repository.create({
      formatGroupId: 'my-bank',
      label: '削除対象',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })
})

describe('findAvailableForAccount', () => {
  it('accountIdに紐づく専用定義と、account_idがNULLの汎用定義の両方を返す', () => {
    const otherAccounts = new SqlJsAccountRepository(db)
    const otherAccountId = otherAccounts.create({
      category: 'liability',
      name: 'カード未払金',
      isReconcilable: false,
    }).id

    const genericDefinition = repository.create({
      formatGroupId: 'generic-bank',
      label: '汎用定義',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })
    const specificDefinition = repository.create({
      accountId: bankAccountId,
      formatGroupId: 'my-bank',
      label: '専用定義',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })
    repository.create({
      accountId: otherAccountId,
      formatGroupId: 'other-bank',
      label: '他の科目専用の定義',
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    const available = repository.findAvailableForAccount(bankAccountId)

    expect(available.map((d) => d.id).sort()).toEqual(
      [genericDefinition.id, specificDefinition.id].sort(),
    )
  })
})
