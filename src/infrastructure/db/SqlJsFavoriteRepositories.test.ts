/**
 * 科目・取引先・プロジェクトのお気に入り(計画Issue #231 フェーズ4)のRepositoryの統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、3つのRepositoryに共通の setFavorite / findFavoriteIds を検証する。
 * 検証する範囲: お気に入りの付け外しとidの一覧、最初はどれもお気に入りでないこと、無効にしてもお気に入りの状態を保つこと、
 * 科目・取引先の統合で統合先の状態を変えず統合元のお気に入りを外すこと(意図しない固定を残さない)、
 * システム管理科目はお気に入りにできないこと、存在しないidを指定してもほかの行に影響しないこと。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'

let db: Database
let accounts: SqlJsAccountRepository
let counterparties: SqlJsCounterpartyRepository
let projects: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  projects = new SqlJsProjectRepository(db)
})

const expense = (name: string) => accounts.create({ category: 'expense', name, isReconcilable: null })

describe('科目のお気に入り', () => {
  it('最初は、どの科目もお気に入りでない', () => {
    expense('食費')

    expect(accounts.findFavoriteIds()).toEqual([])
  })

  it('お気に入りに付けると、idの一覧(id順)に入り、外すと一覧から消える。ほかの科目には影響しない', () => {
    const food = expense('食費')
    const transport = expense('交通費')
    const misc = expense('雑費')

    accounts.setFavorite(transport.id, true)
    accounts.setFavorite(food.id, true)
    expect(accounts.findFavoriteIds()).toEqual([food.id, transport.id])

    accounts.setFavorite(food.id, false)
    expect(accounts.findFavoriteIds()).toEqual([transport.id])
    expect(accounts.findFavoriteIds()).not.toContain(misc.id)
  })

  it('同じ状態を2回指定しても、結果は変わらない', () => {
    const food = expense('食費')

    accounts.setFavorite(food.id, true)
    accounts.setFavorite(food.id, true)

    expect(accounts.findFavoriteIds()).toEqual([food.id])
  })

  it('無効にしても、お気に入りの状態は保たれる(再び有効にすれば、お気に入りのまま)', () => {
    const food = expense('食費')
    accounts.setFavorite(food.id, true)

    accounts.deactivate(food.id)
    expect(accounts.findFavoriteIds()).toEqual([food.id])
    accounts.activate(food.id)

    expect(accounts.findFavoriteIds()).toEqual([food.id])
  })

  it('システム管理科目は、お気に入りにできない(DBのトリガーが拒否する)', () => {
    const advance = accounts.create({ category: 'asset', name: '立替金', isReconcilable: false, isSystemManaged: true })

    expect(() => accounts.setFavorite(advance.id, true)).toThrow(/system-managed/)
    expect(accounts.findFavoriteIds()).toEqual([])
  })

  it('統合すると、統合先のお気に入りの状態は変わらず、統合元のお気に入りは外れる(意図しない固定を残さない)', () => {
    const target = expense('食費')
    const sourceA = expense('食料品')
    const sourceB = expense('外食')
    accounts.setFavorite(sourceA.id, true)
    accounts.setFavorite(sourceB.id, true)

    accounts.merge(target.id, [sourceA.id, sourceB.id])

    // 統合先は元からお気に入りでないので、統合元がお気に入りでも引き継がない
    expect(accounts.findFavoriteIds()).toEqual([])
  })

  it('統合先がお気に入りなら、統合後もお気に入りのまま', () => {
    const target = expense('食費')
    const source = expense('食料品')
    accounts.setFavorite(target.id, true)
    accounts.setFavorite(source.id, true)

    accounts.merge(target.id, [source.id])

    expect(accounts.findFavoriteIds()).toEqual([target.id])
  })

  it('削除すると、その科目はお気に入りの一覧から消える', () => {
    const food = expense('食費')
    accounts.setFavorite(food.id, true)

    accounts.delete(food.id)

    expect(accounts.findFavoriteIds()).toEqual([])
  })
})

describe('取引先のお気に入り', () => {
  it('お気に入りの付け外しと、idの一覧(id順)。最初はどれもお気に入りでない', () => {
    const a = counterparties.create({ name: 'スーパー' })
    const b = counterparties.create({ name: '東京ガス' })
    expect(counterparties.findFavoriteIds()).toEqual([])

    counterparties.setFavorite(b.id, true)
    counterparties.setFavorite(a.id, true)
    expect(counterparties.findFavoriteIds()).toEqual([a.id, b.id])

    counterparties.setFavorite(a.id, false)
    expect(counterparties.findFavoriteIds()).toEqual([b.id])
  })

  it('無効にしても、お気に入りの状態は保たれる', () => {
    const a = counterparties.create({ name: 'スーパー' })
    counterparties.setFavorite(a.id, true)

    counterparties.deactivate(a.id)

    expect(counterparties.findFavoriteIds()).toEqual([a.id])
  })

  it('統合すると、統合先の状態は変わらず、統合元のお気に入りは外れる', () => {
    const target = counterparties.create({ name: 'セブン' })
    const source = counterparties.create({ name: 'セブンイレブン' })
    counterparties.setFavorite(source.id, true)

    counterparties.merge(target.id, [source.id])

    expect(counterparties.findFavoriteIds()).toEqual([])
  })

  it('統合先がお気に入りなら、統合後もお気に入りのまま', () => {
    const target = counterparties.create({ name: 'セブン' })
    const source = counterparties.create({ name: 'セブンイレブン' })
    counterparties.setFavorite(target.id, true)

    counterparties.merge(target.id, [source.id])

    expect(counterparties.findFavoriteIds()).toEqual([target.id])
  })
})

describe('プロジェクトのお気に入り', () => {
  it('お気に入りの付け外しと、idの一覧(id順)。最初はどれもお気に入りでない', () => {
    const a = projects.create({ name: '沖縄旅行' })
    const b = projects.create({ name: '引っ越し' })
    expect(projects.findFavoriteIds()).toEqual([])

    projects.setFavorite(b.id, true)
    projects.setFavorite(a.id, true)
    expect(projects.findFavoriteIds()).toEqual([a.id, b.id])

    projects.setFavorite(a.id, false)
    expect(projects.findFavoriteIds()).toEqual([b.id])
  })

  it('無効にしても、お気に入りの状態は保たれる', () => {
    const a = projects.create({ name: '沖縄旅行' })
    projects.setFavorite(a.id, true)

    projects.deactivate(a.id)

    expect(projects.findFavoriteIds()).toEqual([a.id])
  })

  it('存在しないidを指定しても、エラーにならず、ほかの行に影響しない', () => {
    const a = projects.create({ name: '沖縄旅行' })

    expect(() => projects.setFavorite(999, true)).not.toThrow()

    expect(projects.findFavoriteIds()).toEqual([])
    expect(projects.findById(a.id)).toBeTruthy()
  })
})
