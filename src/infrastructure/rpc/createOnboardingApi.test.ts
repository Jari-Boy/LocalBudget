/**
 * createOnboardingApi のテスト(計画Issue #177)。初回セットアップ画面が使うWorker側のRPC API。
 * getStatusは完了済みかどうかをDBの状態から返し、completeは名前とテンプレートを反映して完了済みにし、
 * skipは何も変えずに完了済みにする。名前が空のcompleteは拒否し、完了済みにならないことを確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { seedDefaultHouseholdMember } from '../db/seedDefaultHouseholdMember'
import { seedDefaultAccounts } from '../db/seedDefaultAccounts'
import { createOnboardingApi } from './createOnboardingApi'

async function setup() {
  const db = await createTestDatabase()
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedDefaultAccounts(db)
  return { db, api: createOnboardingApi(db) }
}

describe('createOnboardingApi', () => {
  it('印が無い新規DBは、未完了を返す', async () => {
    const { api } = await setup()

    expect(api.getStatus()).toEqual({ completed: false })
  })

  it('completeで名前を反映し、完了済みを返すようになる', async () => {
    const { db, api } = await setup()

    api.complete({ memberName: '太郎', template: 'standard' })

    expect(api.getStatus()).toEqual({ completed: true })
    expect(new SqlJsHouseholdMemberRepository(db).findAll()[0].name).toBe('太郎')
  })

  it('名前が空のcompleteは拒否し、未完了のままにする', async () => {
    const { api } = await setup()

    expect(() => api.complete({ memberName: ' ', template: 'standard' })).toThrow()
    expect(api.getStatus()).toEqual({ completed: false })
  })

  it('completeのあと、getChecklistは表示する状態と各項目の達成を返し、dismissChecklistで消える', async () => {
    const { api } = await setup()
    api.complete({ memberName: '太郎', template: 'standard' })

    expect(api.getChecklist()).toMatchObject({ visible: true, memberName: '太郎' })

    api.dismissChecklist()

    expect(api.getChecklist().visible).toBe(false)
  })

  it('markBackupDoneで、チェックリストのバックアップの項目が済みになる', async () => {
    const { api } = await setup()
    api.complete({ memberName: '太郎', template: 'standard' })

    api.markBackupDone()

    expect(api.getChecklist().steps.backup).toBe(true)
  })

  it('skipは名前を変えず、完了済みにする', async () => {
    const { db, api } = await setup()

    api.skip()

    expect(api.getStatus()).toEqual({ completed: true })
    expect(new SqlJsHouseholdMemberRepository(db).findAll()[0].name).toBe('自分')
  })
})
