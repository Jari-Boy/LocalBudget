import type { StorageAdapter } from './StorageAdapter'

/**
 * 書き込みの権利を持たないタブ向けに、save()を何もしない形で包む(計画Issue #174)。
 * 読み込みは元のアダプタに任せる。保存を無視するのは、別のタブが書いた内容を、このタブの
 * 古いDBで上書きしないため。
 */
export function createReadOnlyStorageAdapter(inner: StorageAdapter): StorageAdapter {
  return {
    load: () => inner.load(),
    save: async () => {},
  }
}
