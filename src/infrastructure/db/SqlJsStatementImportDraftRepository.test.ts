/**
 * SqlJsStatementImportDraftRepository(明細取込の一時保存、計画Issue #231 フェーズ3)の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、一時保存の保存・参照・上書き・削除を検証する。
 * 検証する範囲: CSVの生データ(バイト列)・行ごとの入力(JSON)・取り込むファイルのチェックの往復、
 * 取込先の科目ごとに1つで同じ取込先に保存し直すと上書きされる(idは保つ)こと、要約の一覧(新しい順、CSVの中身を含まない)、
 * 削除でCSVも消えること、取込先の科目の削除・マッピング定義の削除との連動。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import type {
  SaveStatementImportDraftInput,
  StatementImportDraftRowInput,
} from '../../domain/statement-import/StatementImportDraft'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from './SqlJsImportMappingDefinitionRepository'
import { SqlJsStatementImportDraftRepository } from './SqlJsStatementImportDraftRepository'

let db: Database
let repository: SqlJsStatementImportDraftRepository
let bankId: number
let cardId: number
let definitionId: number
let memberId: number

const rowInput = (overrides: Partial<StatementImportDraftRowInput> = {}): StatementImportDraftRowInput => ({
  counterpartyId: null,
  counterAccountId: 3,
  counterAccountTouched: true,
  projectId: null,
  householdMemberId: null,
  settlementBatchId: null,
  comment: '',
  includeDuplicate: false,
  approximateDecision: 'different_transaction',
  replacementTargetId: null,
  ...overrides,
})

const bytes = (...values: number[]) => new Uint8Array(values)

function input(overrides: Partial<SaveStatementImportDraftInput> = {}): SaveStatementImportDraftInput {
  return {
    targetAccountId: bankId,
    definitionId,
    ownerMemberId: memberId,
    files: [
      { fileName: 'oct.csv', bytes: bytes(1, 2, 3, 255), isChecked: true },
      { fileName: 'nov.csv', bytes: bytes(9, 8, 7), isChecked: false },
    ],
    rowInputs: { 'ext-1': rowInput({ comment: '週末の買い出し' }) },
    totalRows: 40,
    filledRows: 12,
    ...overrides,
  }
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  bankId = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true }).id
  cardId = accounts.create({ category: 'liability', name: '楽天VISA', isReconcilable: false }).id
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  definitionId = new SqlJsImportMappingDefinitionRepository(db).create({
    formatGroupId: 'my-bank',
    label: 'マイ銀行',
    dateColumn: '日付',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    accountIds: [bankId],
  }).id
  repository = new SqlJsStatementImportDraftRepository(db)
})

describe('save / findById', () => {
  it('CSVの生データ(バイト列)・行ごとの入力・取り込むファイルのチェック・取込先・定義・名義・件数を、そのまま保存して読み出せる', () => {
    const saved = repository.save(input())

    const found = repository.findById(saved.id)!
    expect(found).toMatchObject({
      targetAccountId: bankId,
      definitionId,
      ownerMemberId: memberId,
      totalRows: 40,
      filledRows: 12,
      rowInputs: { 'ext-1': rowInput({ comment: '週末の買い出し' }) },
    })
    expect(found.files.map((f) => f.fileName)).toEqual(['oct.csv', 'nov.csv'])
    expect(found.files.map((f) => f.isChecked)).toEqual([true, false])
    expect(Array.from(found.files[0].bytes)).toEqual([1, 2, 3, 255])
    expect(Array.from(found.files[1].bytes)).toEqual([9, 8, 7])
    expect(found.createdAt).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
  })

  it('ファイルは選んだ順(保存した順)に返る', () => {
    const saved = repository.save(
      input({
        files: [
          { fileName: 'c.csv', bytes: bytes(1), isChecked: true },
          { fileName: 'a.csv', bytes: bytes(2), isChecked: true },
          { fileName: 'b.csv', bytes: bytes(3), isChecked: true },
        ],
      }),
    )

    expect(repository.findById(saved.id)!.files.map((f) => f.fileName)).toEqual(['c.csv', 'a.csv', 'b.csv'])
  })

  it('定義・名義が無い(null)一時保存も保存できる', () => {
    const saved = repository.save(input({ definitionId: null, ownerMemberId: null }))

    expect(repository.findById(saved.id)).toMatchObject({ definitionId: null, ownerMemberId: null })
  })

  it('同じ取込先に保存し直すと上書きされ、idは保たれ、CSVと行ごとの入力は新しい内容に置き換わる', () => {
    const first = repository.save(input())

    const second = repository.save(
      input({
        files: [{ fileName: 'dec.csv', bytes: bytes(5), isChecked: true }],
        rowInputs: { 'ext-9': rowInput({ comment: '更新後' }) },
        totalRows: 41,
        filledRows: 20,
      }),
    )

    expect(second.id).toBe(first.id)
    expect(repository.findSummaries()).toHaveLength(1)
    const found = repository.findById(first.id)!
    expect(found.files.map((f) => f.fileName)).toEqual(['dec.csv'])
    expect(Object.keys(found.rowInputs)).toEqual(['ext-9'])
    expect(found).toMatchObject({ totalRows: 41, filledRows: 20 })
    expect(found.createdAt).toBe(first.createdAt)
  })

  it('別の取込先には、別の一時保存を持てる(取込先の科目ごとに1つ)', () => {
    repository.save(input())
    repository.save(input({ targetAccountId: cardId, definitionId: null }))

    expect(repository.findSummaries()).toHaveLength(2)
  })

  it('存在しないidは null を返す', () => {
    expect(repository.findById(999)).toBeNull()
  })
})

describe('findSummaries / findByAccountId', () => {
  it('要約の一覧は、CSVの中身を含まず、ファイル名・件数・取込先を返し、最後に保存した新しい順に並ぶ', () => {
    const older = repository.save(input())
    db.run("UPDATE statement_import_drafts SET updated_at = '2026-11-01 09:00:00' WHERE id = ?", [older.id])
    const newer = repository.save(input({ targetAccountId: cardId, files: [{ fileName: 'card.csv', bytes: bytes(1), isChecked: true }] }))
    db.run("UPDATE statement_import_drafts SET updated_at = '2026-11-18 21:05:00' WHERE id = ?", [newer.id])

    const summaries = repository.findSummaries()

    expect(summaries.map((s) => s.id)).toEqual([newer.id, older.id])
    expect(summaries[0]).toMatchObject({ targetAccountId: cardId, fileNames: ['card.csv'], totalRows: 40, filledRows: 12, updatedAt: '2026-11-18 21:05:00' })
    expect(summaries[1]).toMatchObject({ targetAccountId: bankId, fileNames: ['oct.csv', 'nov.csv'] })
    expect(summaries[0]).not.toHaveProperty('files')
  })

  it('一時保存が無ければ空の配列を返す', () => {
    expect(repository.findSummaries()).toEqual([])
  })

  it('取込先の科目の一時保存の要約を返し、無ければnullを返す', () => {
    const saved = repository.save(input())

    expect(repository.findByAccountId(bankId)).toMatchObject({ id: saved.id, targetAccountId: bankId })
    expect(repository.findByAccountId(cardId)).toBeNull()
  })
})

describe('delete と連動', () => {
  it('削除すると、一時保存とそのCSVの生データが消える(DBにCSVが残らない)', () => {
    const saved = repository.save(input())

    repository.delete(saved.id)

    expect(repository.findById(saved.id)).toBeNull()
    expect(db.exec('SELECT COUNT(*) FROM statement_import_draft_files')[0].values[0][0]).toBe(0)
  })

  it('存在しないidを削除しても何も起きない', () => {
    expect(() => repository.delete(999)).not.toThrow()
  })

  it('取込先の科目を削除すると、一時保存も消える', () => {
    repository.save(input())

    db.run('DELETE FROM accounts WHERE id = ?', [bankId])

    expect(repository.findSummaries()).toEqual([])
  })

  it('マッピング定義を削除しても一時保存は残り、定義の参照だけが外れる(再開時に定義を作り直せる)', () => {
    const saved = repository.save(input())

    db.run('DELETE FROM import_mapping_definitions WHERE id = ?', [definitionId])

    expect(repository.findById(saved.id)).toMatchObject({ definitionId: null, files: expect.any(Array) })
  })
})
