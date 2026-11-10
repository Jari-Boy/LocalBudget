/**
 * resolveStartupStorage のユニットテスト(計画Issue #174)。起動時、Workerを作る前にメインスレッドで
 * 保存先がそのまま開けるかを判定する。ブラウザ内なら開ける。フォルダなら、ハンドルがあり
 * readwrite権限がgrantedのときだけ開ける。それ以外(ブラウザ再起動で権限が「確認が必要」に戻った、
 * ハンドルが消えた等)は、DBを開かずに「フォルダに再接続」画面へ進ませる。権限の再要求
 * (requestPermission)にはユーザーのクリックが要るため、この判定では行わない。
 * 外部依存: なし。ハンドルは偽物を渡す。
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveStartupStorage } from './resolveStartupStorage'

function handleWith(permission: PermissionState) {
  const requestPermission = vi.fn()
  const handle = { name: '家計簿', queryPermission: async () => permission, requestPermission } as unknown as FileSystemDirectoryHandle
  return { handle, requestPermission }
}

describe('resolveStartupStorage', () => {
  it('ブラウザ内の選択なら、そのまま開ける(ready)', async () => {
    const result = await resolveStartupStorage({
      loadConfig: async () => ({ kind: 'indexeddb' }),
      loadFolderHandle: async () => null,
    })
    expect(result).toEqual({ kind: 'ready' })
  })

  it('フォルダの選択で権限がgrantedなら、そのまま開ける(ready)', async () => {
    const { handle } = handleWith('granted')
    const result = await resolveStartupStorage({
      loadConfig: async () => ({ kind: 'folder' }),
      loadFolderHandle: async () => handle,
    })
    expect(result).toEqual({ kind: 'ready' })
  })

  it('フォルダの選択で権限がpromptなら、再接続が必要(フォルダ名とハンドルを返す)で、権限は要求しない', async () => {
    const { handle, requestPermission } = handleWith('prompt')
    const result = await resolveStartupStorage({
      loadConfig: async () => ({ kind: 'folder' }),
      loadFolderHandle: async () => handle,
    })
    expect(result).toEqual({ kind: 'needs-reconnect', folderName: '家計簿', handle })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('フォルダの選択で権限がdeniedでも、再接続が必要として扱う', async () => {
    const { handle } = handleWith('denied')
    const result = await resolveStartupStorage({
      loadConfig: async () => ({ kind: 'folder' }),
      loadFolderHandle: async () => handle,
    })
    expect(result).toEqual({ kind: 'needs-reconnect', folderName: '家計簿', handle })
  })

  it('フォルダの選択なのにハンドルが無ければ、フォルダ名なし・ハンドルなしで再接続が必要', async () => {
    const result = await resolveStartupStorage({
      loadConfig: async () => ({ kind: 'folder' }),
      loadFolderHandle: async () => null,
    })
    expect(result).toEqual({ kind: 'needs-reconnect', folderName: null, handle: null })
  })
})
