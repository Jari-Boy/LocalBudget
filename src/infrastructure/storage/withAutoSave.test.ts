/**
 * withAutoSave のユニットテスト。sql.jsのDatabase.run呼び出しを監視し、
 * トランザクション境界(BEGIN〜COMMIT/ROLLBACK)単位での書き込みをSAVE_DEBOUNCE_MS(2秒)の
 * trailing debounceでStorageAdapter.saveへまとめること、flush()でデバウンスタイマーを
 * 待たず即座に保存できること、および保存が進行中に新たな保存要求(visibilitychangeと
 * pagehideがほぼ同時に発火するケース等)が重なってもstorageAdapter.save()が同時に
 * 多重実行されないことを検証する(計画Issue #58)。sql.jsはNode/Vitest上でそのまま
 * 動作するため統合テストとして書く(docs/architecture.md 10章)。
 * 外部依存: sql.js(ネットワークアクセスなし)。タイマーはvitestのfake timerで制御する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../db/createTestDatabase'
import type { StorageAdapter } from './StorageAdapter'
import { SAVE_DEBOUNCE_MS, withAutoSave } from './withAutoSave'

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

/**
 * save()呼び出しを外部から制御できるStorageAdapter。save()は明示的にresolveAll()を
 * 呼ぶまで完了しないPromiseを返すため、保存が進行中の状態を意図的に作り出し、
 * 同時に何回save()が実行中か(activeSaveCount)を検証できる。
 */
function createControllableStorageAdapter(): StorageAdapter & {
  saveCallCount: number
  maxConcurrentSaveCalls: number
  resolveAll(): void
} {
  let activeSaveCount = 0
  let maxConcurrentSaveCalls = 0
  let saveCallCount = 0
  const pendingResolvers: Array<() => void> = []
  return {
    get saveCallCount() {
      return saveCallCount
    },
    get maxConcurrentSaveCalls() {
      return maxConcurrentSaveCalls
    },
    async load() {
      return null
    },
    save() {
      saveCallCount += 1
      activeSaveCount += 1
      maxConcurrentSaveCalls = Math.max(maxConcurrentSaveCalls, activeSaveCount)
      return new Promise<void>((resolve) => {
        pendingResolvers.push(() => {
          activeSaveCount -= 1
          resolve()
        })
      })
    },
    resolveAll() {
      const resolvers = pendingResolvers.splice(0, pendingResolvers.length)
      resolvers.forEach((resolve) => {
        resolve()
      })
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

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withAutoSave', () => {
  it('トランザクションを伴わない単発のrun()呼び出し直後は、まだsave()が呼ばれない(デバウンス待機中)', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')

    expect(storageAdapter.saveCallCount).toBe(0)
  })

  it('単発のrun()呼び出しからSAVE_DEBOUNCE_MS経過するとsave()が1回呼ばれる', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    db.run('INSERT INTO t (id) VALUES (1)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('SAVE_DEBOUNCE_MS未満の間隔で連続したrun()はタイマーをリセットし、最後の呼び出しから\
SAVE_DEBOUNCE_MS経過するまでsave()を呼ばない', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1000)
    db.run('INSERT INTO t (id) VALUES (1)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1000)

    expect(storageAdapter.saveCallCount).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('短時間に連続した複数回のrun()は1回のsave()にまとめられる', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    db.run('INSERT INTO t (id) VALUES (1)')
    db.run('INSERT INTO t (id) VALUES (2)')
    db.run('INSERT INTO t (id) VALUES (3)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('BEGIN〜COMMITで囲まれた複数のrun()呼び出しは、COMMIT完了からSAVE_DEBOUNCE_MS経過後に\
1回だけsave()が呼ばれる', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('BEGIN')
    db.run('INSERT INTO t (id) VALUES (1)')
    db.run('INSERT INTO t (id) VALUES (2)')
    db.run('COMMIT')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('BEGIN〜ROLLBACKの場合もROLLBACK完了からSAVE_DEBOUNCE_MS経過後に1回だけsave()が呼ばれる', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('BEGIN')
    db.run('INSERT INTO t (id) VALUES (1)')
    db.run('ROLLBACK')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

    expect(storageAdapter.saveCallCount).toBe(1)
  })

  it('exec()による読み取りはsave()をスケジュールしない', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE t (id INTEGER)')
    db.run('INSERT INTO t (id) VALUES (1)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.exec('SELECT * FROM t')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

    expect(storageAdapter.saveCallCount).toBe(0)
  })

  it('save()に渡されるバイト列はdb.export()が返す最新のスナップショットと一致する', async () => {
    const db = await createTestDatabase()
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('CREATE TABLE t (id INTEGER)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

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

  it('save()実行(db.export())後もPRAGMA foreign_keysがONのままで、ON DELETE CASCADEが機能し続ける(計画Issue #40で発覚)', async () => {
    // db.export()はsql.js内部でPRAGMA foreign_keysをOFFにリセットする副作用も持つ
    // (実測で確認済み、last_insert_rowid()のリセットと同種)。これによりsave()が一度でも
    // 実行された後は、以降のON DELETE CASCADE(journal_entry_links等)が機能しなくなる。
    const db = await createTestDatabase()
    db.run(
      'CREATE TABLE parent (id INTEGER PRIMARY KEY)',
    )
    db.run(
      'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE)',
    )
    db.run('INSERT INTO parent (id) VALUES (1)')
    db.run('INSERT INTO child (id, parent_id) VALUES (1, 1)')
    const storageAdapter = createRecordingStorageAdapter()
    withAutoSave(db, storageAdapter)

    db.run('INSERT INTO parent (id) VALUES (2)')
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
    expect(storageAdapter.saveCallCount).toBe(1)

    db.run('DELETE FROM parent WHERE id = 1')
    const [result] = db.exec('SELECT * FROM child')

    expect(result).toBeUndefined()
  })

  describe('flush()', () => {
    it('保留中のデバウンスタイマーを待たず、呼び出し直後にsave()を実行する', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createRecordingStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await controller.flush()

      expect(storageAdapter.saveCallCount).toBe(1)
    })

    it('flush()後、保留中だったタイマーは解除され、SAVE_DEBOUNCE_MS経過しても重複してsave()が呼ばれない', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createRecordingStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await controller.flush()
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

      expect(storageAdapter.saveCallCount).toBe(1)
    })

    it('保留中の変更がない状態でflush()を呼んでも例外を投げず保存が完了する', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createRecordingStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      await expect(controller.flush()).resolves.toBeUndefined()
      expect(storageAdapter.saveCallCount).toBe(1)
    })

    it('flush()が返すPromiseは実際の保存完了を待つ', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createRecordingStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await controller.flush()

      expect(storageAdapter.savedSnapshots[0]).toEqual(db.export())
    })
  })

  describe('保存の多重実行防止', () => {
    it('保存が進行中の状態でflush()がもう一度呼ばれても、save()は同時に多重実行されず、\
完了後に1回だけ再実行される', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createControllableStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      const firstFlush = controller.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(storageAdapter.saveCallCount).toBe(1)

      // visibilitychangeとpagehideがほぼ同時に発火するケースを想定し、
      // 1回目のsave()完了前にもう一度flush()を呼ぶ
      const secondFlush = controller.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(storageAdapter.saveCallCount).toBe(1)
      expect(storageAdapter.maxConcurrentSaveCalls).toBe(1)

      storageAdapter.resolveAll()
      await vi.advanceTimersByTimeAsync(0)
      expect(storageAdapter.saveCallCount).toBe(2)
      expect(storageAdapter.maxConcurrentSaveCalls).toBe(1)

      storageAdapter.resolveAll()
      await expect(Promise.all([firstFlush, secondFlush])).resolves.toEqual([undefined, undefined])
    })

    it('保存が進行中の間に3回以上flush()が重なっても、再実行は1回だけにまとめられる', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createControllableStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      const flushes = [controller.flush(), controller.flush(), controller.flush()]
      await vi.advanceTimersByTimeAsync(0)
      expect(storageAdapter.saveCallCount).toBe(1)

      storageAdapter.resolveAll()
      await vi.advanceTimersByTimeAsync(0)
      expect(storageAdapter.saveCallCount).toBe(2)
      expect(storageAdapter.maxConcurrentSaveCalls).toBe(1)

      storageAdapter.resolveAll()
      await Promise.all(flushes)
    })

    it('デバウンスタイマーの発火とflush()が競合しても、save()は同時に多重実行されない', async () => {
      const db = await createTestDatabase()
      const storageAdapter = createControllableStorageAdapter()
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
      expect(storageAdapter.saveCallCount).toBe(1)

      db.run('INSERT INTO t (id) VALUES (1)')
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1)
      const flush = controller.flush()
      await vi.advanceTimersByTimeAsync(0)

      expect(storageAdapter.maxConcurrentSaveCalls).toBe(1)

      // 1回目(CREATE TABLE分)のsave()完了 → INSERT分を捉える再実行がトリガーされる
      storageAdapter.resolveAll()
      await vi.advanceTimersByTimeAsync(0)
      // 再実行されたsave()を完了させる
      storageAdapter.resolveAll()
      await flush

      expect(storageAdapter.maxConcurrentSaveCalls).toBe(1)
    })
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
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

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
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

      expect(controller.getLastSaveError()).toBe(saveError)
    })

    it('失敗後にsave()が成功すると、getLastSaveError()はnullに戻る', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = await createTestDatabase()
      const saveError = new Error('IndexedDB quota exceeded')
      const storageAdapter = createFlakyStorageAdapter(1, saveError)
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
      expect(controller.getLastSaveError()).toBe(saveError)

      db.run('INSERT INTO t (id) VALUES (1)')
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

      expect(controller.getLastSaveError()).toBeNull()
      expect(storageAdapter.savedSnapshots.length).toBe(1)
    })

    it('flush()経由での保存失敗もgetLastSaveError()で検知できる', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = await createTestDatabase()
      const saveError = new Error('IndexedDB quota exceeded')
      const storageAdapter = createFailingStorageAdapter(saveError)
      const controller = withAutoSave(db, storageAdapter)

      db.run('CREATE TABLE t (id INTEGER)')
      await controller.flush()

      expect(controller.getLastSaveError()).toBe(saveError)
    })
  })
})
