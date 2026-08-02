/**
 * ensureReadWritePermission のユニットテスト。FileSystemDirectoryHandleに対する
 * readwrite権限が確立しているかをqueryPermission/requestPermissionの2段階で確認する
 * (docs/architecture.md 4.2節、計画Issue #57 目標1「次回起動時にqueryPermission/
 * requestPermissionで権限を再確認する」)。FileSystemDirectoryHandleはNode環境に
 * 実装がないため、queryPermission/requestPermissionのみを持つモックオブジェクトで
 * 権限state(granted/prompt/denied)の分岐を検証する。
 * 外部依存: なし。
 */
import { describe, expect, it } from 'vitest'
import { ensureReadWritePermission } from './ensureReadWritePermission'

function createMockHandle(
  queryResult: PermissionState,
  requestResult: PermissionState,
): FileSystemDirectoryHandle & { requestPermissionCalled: boolean } {
  const state = { requestPermissionCalled: false }
  return {
    ...state,
    get requestPermissionCalled() {
      return state.requestPermissionCalled
    },
    async queryPermission() {
      return queryResult
    },
    async requestPermission() {
      state.requestPermissionCalled = true
      return requestResult
    },
  } as unknown as FileSystemDirectoryHandle & { requestPermissionCalled: boolean }
}

describe('ensureReadWritePermission', () => {
  it('queryPermissionがgrantedを返す場合、requestPermissionを呼ばずにtrueを返す', async () => {
    const handle = createMockHandle('granted', 'granted')

    const result = await ensureReadWritePermission(handle)

    expect(result).toBe(true)
    expect(handle.requestPermissionCalled).toBe(false)
  })

  it('queryPermissionがpromptを返す場合、requestPermissionを呼び、grantedならtrueを返す', async () => {
    const handle = createMockHandle('prompt', 'granted')

    const result = await ensureReadWritePermission(handle)

    expect(result).toBe(true)
    expect(handle.requestPermissionCalled).toBe(true)
  })

  it('queryPermissionがpromptで、requestPermissionがdeniedを返す場合、falseを返す', async () => {
    const handle = createMockHandle('prompt', 'denied')

    const result = await ensureReadWritePermission(handle)

    expect(result).toBe(false)
  })

  it('queryPermissionがdeniedを返す場合、requestPermissionを呼ばずにfalseを返す', async () => {
    const handle = createMockHandle('denied', 'granted')

    const result = await ensureReadWritePermission(handle)

    expect(result).toBe(false)
    expect(handle.requestPermissionCalled).toBe(false)
  })
})
