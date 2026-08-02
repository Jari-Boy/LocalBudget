/**
 * withAutoSave のユニットテスト。sql.jsのDatabase.run呼び出しを監視し、
 * トランザクション境界(BEGIN〜COMMIT/ROLLBACK)単位でStorageAdapter.saveが
 * 呼ばれることを検証する。sql.jsはNode/Vitest上でそのまま動作するため
 * 統合テストとして書く(docs/architecture.md 10章)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../db/createTestDatabase'
import type { StorageAdapter } from './StorageAdapter'
import { withAutoSave } from './withAutoSave'

function createRecordingStorageAdapter(): StorageAdapter & {
  saveCallCount: number
  savedSnapshots: Uint8Array[]
} {
  const savedSnapshots: Uint8Array[] = []
  return {
    savedSnapshots,
    get saveCallCount() {
      return savedSnapshots.length
    },
    async load() {
      return null
    },
    async save(data) {
      savedSnapshots.push(data)
    },
  }
}

function createFailingStorageAdapter(error: Error): StorageAdapter {
  return {
    async load() {
      return null
    },
    async save() {
      throw error
    },
  }
}

/** 最初のfailTimes回のsave()はerrorをthrowし、それ以降は成功してdataを記録する。 */
function createFlakyStorageAdapter(
  failTimes: number,
  error: Error,
): StorageAdapter & { savedSnapshots: Uint8Array[] } {
  let callCount = 0
  const savedSnapshots: Uint8Array[] = []
  return {
    savedSnapshots,
    async load() {
      return null
    },
    async save(data) {
      callCount += 1
      if (callCount <= failTimes) {
        throw error
      }
      savedSnapshots.push(data)
    },
  }
}

/**
 * withAutoSaveはdb.export()の呼び出しをqueueMicrotaskで遅延させるため、
 * save()が呼ばれたかを確認するにはマイクロタスクキューを空にする必要がある。
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('withAutoSave', () => {
  it('トランザクションを伴わない単発のrun()呼び出しのたびにsave()が呼ばれる', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    db.run('INSERT INTO t (id) VALUES (1)')
    await flushMicrotasks()

    expect(storageAdapter.saveCallCount).toBe(2)
  })

  it('BEGIN〜COMMITで囲まれた複数のrun()呼び出しは、COMMIT完了後に1回だけsave()が呼ばれる', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('BEGIN')
    db.run('INSERT INTO t (id) VALUES (1)')
    db.run('INSERT INTO t (id) VALUES (2)')
    db.run('COMMIT')
    await flushMicrotasks()

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('BEGIN〜ROLLBACKの場合もROLLBACK完了後に1回だけsave()が呼ばれる', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('BEGIN')
    db.run('INSERT INTO t (id) VALUES (1)')
    db.run('ROLLBACK')
    await flushMicrotasks()

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('exec()による読み取りはsave()を呼ばない', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    db.run('INSERT INTO t (id) VALUES (1)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.exec('SELECT * FROM t')
    await flushMicrotasks()

    expect(storageAdapter.saveCallCount).toBe(0)
  })

  it('save()に渡されるバイト列はdb.export()が返す最新のスナップショットと一致する', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    await flushMicrotasks()

    expect(storageAdapter.savedSnapshots[0]).toEqual(db.export())
  })

  it('run()呼び出し直後にlast_insert_rowid()を参照しても正しい値が取得できる(db.export()の遅延実行を検証)', async () => {
    // db.export()はsql.js内部でSQLiteのlast_insert_rowid()をリセットする副作用を持つため
    // (実測で確認済み)、withAutoSaveがrun()の中で同期的にexport()を呼ぶと、直後に
    // last_insert_rowid()を読むRepositoryのcreate()実装が全て壊れる。
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('INSERT INTO t (name) VALUES (?)', ['a'])
    const [result] = db.exec('SELECT last_insert_rowid() AS id')

    expect(result.values[0][0]).toBe(1)
  })

  describe('save()が失敗した場合', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('unhandled rejectionにならず、console.errorでログに残る', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const unhandledRejections: unknown[] = []
      const onUnhandledRejection = (reason: unknown): void => {
        unhandledRejections.push(reason)
      }
      process.on('unhandledRejection', onUnhandledRejection)

      const db = await createTestDatabase()
      const saveError = new Error('IndexedDB quota exceeded')
      const storageAdapter = createFailingStorageAdapter(saveError)
      withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await flushMicrotasks()

      process.off('unhandledRejection', onUnhandledRejection)
      expect(unhandledRejections).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), saveError)
    })

    it('getLastSaveError()で直近の保存失敗を検知できる', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = await createTestDatabase()
      const saveError = new Error('IndexedDB quota exceeded')
      const storageAdapter = createFailingStorageAdapter(saveError)
      const controller = withAutoSave(db, storageAdapter)

      expect(controller.getLastSaveError()).toBeNull()

      db.run('CREATE TABLE t (id INTEGER)')
      await flushMicrotasks()

      expect(controller.getLastSaveError()).toBe(saveError)
    })

    it('失敗後にsave()が成功すると、getLastSaveError()はnullに戻る', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = await createTestDatabase()
      const saveError = new Error('IndexedDB quota exceeded')
      const storageAdapter = createFlakyStorageAdapter(1, saveError)
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await flushMicrotasks()
      expect(controller.getLastSaveError()).toBe(saveError)

      db.run('INSERT INTO t (id) VALUES (1)')
      await flushMicrotasks()

      expect(controller.getLastSaveError()).toBeNull()
      expect(storageAdapter.savedSnapshots.length).toBe(1)
    })
  })
})
