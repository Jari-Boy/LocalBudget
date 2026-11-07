/**
 * SqlJsImportMappingDefinitionRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/statement-import.md 2章・
 * docs/schema/statement_import.sql に定義されたマッピング定義(import_mapping_definitions)の
 * 作成・参照・更新・削除、amount_modeに応じた列指定の整合性を強制するDDL側CHECK制約との連携、
 * 定義と科目の多対多の紐づけ(import_mapping_definition_accounts、accountIds)、紐づいた科目の定義を先頭に
 * 並べつつ全定義を返すfindAvailableForAccount、紐づけを追加するlinkAccount、科目・定義の削除時の
 * 紐づけの連鎖削除を検証する。
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
    expect(found?.accountIds).toEqual([])
    expect(found?.encoding).toBe('utf-8')
    expect(found?.delimiter).toBe(',')
    expect(found?.headerRowCount).toBe(1)
  })

  it('debit_credit_split形式の定義を作成しidで参照できる', () => {
    const created = repository.create({
      accountIds: [bankAccountId],
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

    expect(found?.accountIds).toEqual([bankAccountId])
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
  it('labelとaccountIdsを更新できる', () => {
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
      accountIds: [bankAccountId],
    })

    expect(updated.label).toBe('確定ラベル')
    expect(updated.accountIds).toEqual([bankAccountId])
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

const SAMPLE = {
  formatGroupId: 'my-bank',
  dateColumn: '0',
  dateFormat: 'YYYY/MM/DD',
  descriptionColumn: '1',
  amountMode: 'single_signed' as const,
  amountColumn: '2',
}

describe('accountIds(対応する科目の複数指定)', () => {
  it('1つの定義に複数の科目を紐づけて保存・参照でき、科目ID順に返る', () => {
    const accounts = new SqlJsAccountRepository(db)
    const cardId = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false }).id

    const created = repository.create({ ...SAMPLE, label: '共有定義', accountIds: [cardId, bankAccountId] })

    expect(repository.findById(created.id)?.accountIds).toEqual([bankAccountId, cardId].sort((a, b) => a - b))
  })

  it('updateでaccountIdsを差し替えると、外した科目との紐づけが消える', () => {
    const accounts = new SqlJsAccountRepository(db)
    const cardId = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false }).id
    const created = repository.create({ ...SAMPLE, label: '共有定義', accountIds: [bankAccountId, cardId] })

    const updated = repository.update(created.id, { accountIds: [cardId] })

    expect(updated.accountIds).toEqual([cardId])
  })

  it('updateでaccountIdsを指定しなければ紐づけは変わらない', () => {
    const created = repository.create({ ...SAMPLE, label: '定義', accountIds: [bankAccountId] })

    const updated = repository.update(created.id, { label: '改名' })

    expect(updated.accountIds).toEqual([bankAccountId])
  })

  it('科目を物理削除すると、その科目との紐づけだけが消え定義は残る', () => {
    const accounts = new SqlJsAccountRepository(db)
    const cardId = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false }).id
    const created = repository.create({ ...SAMPLE, label: '共有定義', accountIds: [bankAccountId, cardId] })

    accounts.delete(bankAccountId)

    expect(repository.findById(created.id)?.accountIds).toEqual([cardId])
  })

  it('定義を削除すると紐づけも消える', () => {
    const created = repository.create({ ...SAMPLE, label: '定義', accountIds: [bankAccountId] })

    repository.delete(created.id)

    const [rows] = db.exec('SELECT COUNT(*) FROM import_mapping_definition_accounts')
    expect(rows.values[0][0]).toBe(0)
  })
})

describe('linkAccount', () => {
  it('定義に科目との紐づけを追加する', () => {
    const created = repository.create({ ...SAMPLE, label: '定義' })

    repository.linkAccount(created.id, bankAccountId)

    expect(repository.findById(created.id)?.accountIds).toEqual([bankAccountId])
  })

  it('同じ紐づけを繰り返し追加しても重複せず、例外にもならない', () => {
    const created = repository.create({ ...SAMPLE, label: '定義' })

    repository.linkAccount(created.id, bankAccountId)
    repository.linkAccount(created.id, bankAccountId)

    expect(repository.findById(created.id)?.accountIds).toEqual([bankAccountId])
  })
})

describe('findAvailableForAccount', () => {
  it('紐づけは制限ではなく優先順位であり、全定義を返す(紐づいた定義が先頭、残りはid順)', () => {
    const accounts = new SqlJsAccountRepository(db)
    const otherAccountId = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false }).id

    const unlinked = repository.create({ ...SAMPLE, label: '紐づけなし' })
    const linkedToOther = repository.create({ ...SAMPLE, label: '他の科目に紐づく', accountIds: [otherAccountId] })
    const linkedToBank = repository.create({ ...SAMPLE, label: 'この科目に紐づく', accountIds: [bankAccountId] })

    const available = repository.findAvailableForAccount(bankAccountId)

    expect(available.map((d) => d.id)).toEqual([linkedToBank.id, unlinked.id, linkedToOther.id])
  })

  it('複数の科目に紐づく定義は、そのどの科目の取込でも先頭になる', () => {
    const accounts = new SqlJsAccountRepository(db)
    const cardId = accounts.create({ category: 'liability', name: 'カード未払金', isReconcilable: false }).id
    const first = repository.create({ ...SAMPLE, label: '先に作った無関係な定義' })
    const shared = repository.create({ ...SAMPLE, label: '共有定義', accountIds: [bankAccountId, cardId] })

    expect(repository.findAvailableForAccount(bankAccountId)[0].id).toBe(shared.id)
    expect(repository.findAvailableForAccount(cardId)[0].id).toBe(shared.id)
    expect(repository.findAvailableForAccount(cardId).map((d) => d.id)).toContain(first.id)
  })
})
