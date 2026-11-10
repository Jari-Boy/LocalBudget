export const WRITE_LOCK_NAME = 'local-budget-write'

/**
 * 保存先への「書き込みの権利」を取る(計画Issue #174、docs/architecture.md 4.2節)。
 * 2つのタブが同じ保存先へ書くと、後から保存したタブが先の内容を古いDBで上書きするため、
 * Web Locks APIの排他ロックを一つのタブ(Worker)だけが持てるようにする。取れなかったタブは
 * 読み取り専用で動かす。取れたロックは解放しない(Workerが終わる=タブが閉じると自動で解放される)。
 * Web Locksが無い環境(locksがundefined)では競合を防げないため、書き込める扱いにする。
 */
export async function acquireWriteLock(locks: LockManager | undefined): Promise<boolean> {
  if (!locks) return true

  return new Promise<boolean>((resolve, reject) => {
    // コールバックが返すPromiseが解決されない限りロックは持たれたままになる
    locks
      .request(WRITE_LOCK_NAME, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock === null ? undefined : new Promise<void>(() => {})
      })
      .catch(reject)
  })
}
