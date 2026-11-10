/**
 * createReadOnlyStorageAdapter のユニットテスト(計画Issue #174)。書き込みの権利を持たない
 * 2つ目のタブでは、読み込みはそのまま行い、保存は元のアダプタに渡さず何もしない
 * (別のタブが書いた内容を、このタブの古いDBで上書きしないため)。
 * 外部依存: なし。
 */
import { describe, expect, it, vi } from 'vitest'
import { createReadOnlyStorageAdapter } from './readOnlyStorageAdapter'
import type { StorageAdapter } from './StorageAdapter'

describe('createReadOnlyStorageAdapter', () => {
  it('load()は元のアダプタの結果をそのまま返す', async () => {
    const inner: StorageAdapter = { load: vi.fn(async () => new Uint8Array([1])), save: vi.fn() }
    const adapter = createReadOnlyStorageAdapter(inner)
    expect(await adapter.load()).toEqual(new Uint8Array([1]))
  })

  it('save()は元のアダプタを呼ばずに正常終了する', async () => {
    const inner: StorageAdapter = { load: vi.fn(), save: vi.fn() }
    const adapter = createReadOnlyStorageAdapter(inner)
    await expect(adapter.save(new Uint8Array([9]))).resolves.toBeUndefined()
    expect(inner.save).not.toHaveBeenCalled()
  })
})
