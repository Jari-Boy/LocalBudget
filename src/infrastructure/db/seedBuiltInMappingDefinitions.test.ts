/**
 * 組み込みマッピング定義(docs/domain/statement-import.md 2.3節「OSSとして主要金融機関向けの
 * 定義がアプリに同梱される想定」)を投入するseedBuiltInMappingDefinitionsの統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、DB投入内容の正しさと、複数回呼び出しても
 * 重複投入されない冪等性を検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsImportMappingDefinitionRepository } from './SqlJsImportMappingDefinitionRepository'
import { seedBuiltInMappingDefinitions } from './seedBuiltInMappingDefinitions'
import { BUILT_IN_MAPPING_DEFINITIONS } from './builtInMappingDefinitions'

let db: Database
let repository: SqlJsImportMappingDefinitionRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsImportMappingDefinitionRepository(db)
})

describe('seedBuiltInMappingDefinitions', () => {
  it('組み込み定義がaccount_id = NULLの汎用定義としてすべて投入される', () => {
    seedBuiltInMappingDefinitions(db)

    const definitions = repository.findAll()
    expect(definitions).toHaveLength(BUILT_IN_MAPPING_DEFINITIONS.length)
    expect(definitions.every((definition) => definition.accountId === null)).toBe(true)
  })

  it('楽天カードの確定/速報明細が別定義として投入され、列構成が正しい', () => {
    seedBuiltInMappingDefinitions(db)

    const definitions = repository.findAll().filter((definition) => definition.formatGroupId === 'rakuten-card')
    expect(definitions).toHaveLength(2)

    const settled = definitions.find((definition) => definition.isSettled === true)
    expect(settled?.dateColumn).toBe('利用日')
    expect(settled?.dateFormat).toBe('YYYY/MM/DD')
    expect(settled?.descriptionColumn).toBe('利用店名・商品名')
    expect(settled?.amountColumn).toBe('利用金額')

    const unsettled = definitions.find((definition) => definition.isSettled === false)
    expect(unsettled).toBeDefined()
  })

  it('楽天銀行の定義はshift-jisエンコーディング・YYYYMMDD形式・残高列を持つ', () => {
    seedBuiltInMappingDefinitions(db)

    const definition = repository.findAll().find((d) => d.formatGroupId === 'rakuten-bank')
    expect(definition?.encoding).toBe('shift-jis')
    expect(definition?.dateColumn).toBe('取引日')
    expect(definition?.dateFormat).toBe('YYYYMMDD')
    expect(definition?.descriptionColumn).toBe('入出金内容')
    expect(definition?.amountColumn).toBe('入出金(円)')
    expect(definition?.balanceColumn).toBe('取引後残高(円)')
  })

  it('PayPayカードの確定明細の定義が投入される', () => {
    seedBuiltInMappingDefinitions(db)

    const definition = repository.findAll().find((d) => d.formatGroupId === 'paypay-card')
    expect(definition?.isSettled).toBe(true)
    expect(definition?.dateColumn).toBe('利用日/キャンセル日')
    expect(definition?.amountColumn).toBe('利用金額')
  })

  it('複数回呼び出しても重複して投入されない(冪等)', () => {
    seedBuiltInMappingDefinitions(db)
    seedBuiltInMappingDefinitions(db)

    expect(repository.findAll()).toHaveLength(BUILT_IN_MAPPING_DEFINITIONS.length)
  })

  it('既に同じformat_group_id・is_settledの組み込み定義が存在する場合はスキップし、それ以外の科目専用定義には影響しない', () => {
    const userDefinition = repository.create({
      accountId: null,
      formatGroupId: 'rakuten-card',
      isSettled: true,
      label: 'ユーザーが独自にカスタマイズした楽天カード定義',
      dateColumn: '0',
      dateFormat: 'YYYY-MM-DD',
      descriptionColumn: '1',
      amountMode: 'single_signed',
      amountColumn: '2',
    })

    seedBuiltInMappingDefinitions(db)

    const rakutenCardSettled = repository
      .findAll()
      .filter((d) => d.formatGroupId === 'rakuten-card' && d.isSettled === true)
    expect(rakutenCardSettled).toHaveLength(1)
    expect(rakutenCardSettled[0].id).toBe(userDefinition.id)
    expect(rakutenCardSettled[0].label).toBe('ユーザーが独自にカスタマイズした楽天カード定義')
  })
})
