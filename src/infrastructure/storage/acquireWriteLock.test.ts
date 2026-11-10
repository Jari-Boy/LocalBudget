/**
 * acquireWriteLock のユニットテスト(計画Issue #174)。2つのタブが同じ保存先へ同時に書き込む
 * 競合を防ぐため、Web Locks APIで「書き込みの権利」を一つのタブだけが持てるようにする。
 * 取れたかどうかを返し、取れたロックはタブ(Worker)が終わるまで持ち続ける。
 * 外部依存: なし。LockManagerは偽物を渡す。
 */
import { describe, expect, it } from 'vitest'
import { acquireWriteLock, WRITE_LOCK_NAME } from './acquireWriteLock'

/** ifAvailableの要求に、名前ごとに最初の一つだけロックを渡す偽のLockManager。 */
function createFakeLocks(): LockManager {
  const held = new Set<string>()
  return {
    request: async (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
      if (options.ifAvailable && held.has(name)) return callback(null)
      held.add(name)
      // 実物のLockManagerと同じく、コールバックの戻り値が解決するまでロックを持ち続ける
      return callback({ name, mode: 'exclusive' } as Lock)
    },
  } as unknown as LockManager
}

describe('acquireWriteLock', () => {
  it('最初の呼び出しはtrue、同じ名前の2回目はfalseを返す', async () => {
    const locks = createFakeLocks()
    expect(await acquireWriteLock(locks)).toBe(true)
    expect(await acquireWriteLock(locks)).toBe(false)
  })

  it('書き込みロックの名前で要求する', async () => {
    const names: string[] = []
    const locks = {
      request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
        names.push(name)
        return callback(null)
      },
    } as unknown as LockManager
    await acquireWriteLock(locks)
    expect(names).toEqual([WRITE_LOCK_NAME])
  })

  it('Web Locksが使えない環境(undefined)では書き込めるものとしてtrueを返す', async () => {
    expect(await acquireWriteLock(undefined)).toBe(true)
  })
})
