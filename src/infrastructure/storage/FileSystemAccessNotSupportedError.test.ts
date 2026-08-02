/**
 * FileSystemAccessNotSupportedError のユニットテスト。File System Access API非対応環境
 * (Firefox/Safari等)でFileSystemAccessStorageAdapterの使用を試みた際にスローされる
 * エラー型で、呼び出し側(UI側、計画Issue #57ではスコープ外)がinstanceofで判定できる
 * ことを保証する(docs/decisions.md「エラー型の使い分け基準」参照)。
 * 外部依存: なし。
 */
import { describe, expect, it } from 'vitest'
import { FileSystemAccessNotSupportedError } from './FileSystemAccessNotSupportedError'

describe('FileSystemAccessNotSupportedError', () => {
  it('Errorのサブクラスであり、instanceofで判定できる', () => {
    const error = new FileSystemAccessNotSupportedError()

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FileSystemAccessNotSupportedError)
  })

  it('nameがFileSystemAccessNotSupportedErrorになる', () => {
    const error = new FileSystemAccessNotSupportedError()

    expect(error.name).toBe('FileSystemAccessNotSupportedError')
  })
})
