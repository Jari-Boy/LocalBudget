/**
 * describeFolderDatabase のユニットテスト(計画Issue #174)。選んだフォルダに既に
 * local-budget.sqlite があるかを調べ、あれば「開く/上書き」の選択ダイアログに出す
 * サイズと更新日時を返す。無ければnull。FileSystemDirectoryHandleはNodeに実装がないため
 * getFileHandleだけを持つ偽物で検証する。
 * 外部依存: なし。
 */
import { describe, expect, it } from 'vitest'
import { describeFolderDatabase } from './describeFolderDatabase'

function folderWith(files: Record<string, { size: number; lastModified: number }>): FileSystemDirectoryHandle {
  return {
    async getFileHandle(name: string) {
      const file = files[name]
      if (!file) throw new DOMException('not found', 'NotFoundError')
      return { getFile: async () => file }
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('describeFolderDatabase', () => {
  it('ファイルがあればサイズと更新日時を返す', async () => {
    const folder = folderWith({ 'local-budget.sqlite': { size: 4096, lastModified: 1_700_000_000_000 } })
    expect(await describeFolderDatabase(folder)).toEqual({ size: 4096, lastModified: 1_700_000_000_000 })
  })

  it('ファイルが無ければnullを返す', async () => {
    expect(await describeFolderDatabase(folderWith({}))).toBeNull()
  })

  it('NotFound以外のエラーはそのまま投げる', async () => {
    const folder = {
      async getFileHandle() {
        throw new DOMException('denied', 'NotAllowedError')
      },
    } as unknown as FileSystemDirectoryHandle
    await expect(describeFolderDatabase(folder)).rejects.toThrow('denied')
  })
})
