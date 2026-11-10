/**
 * 書き込みの権利を持たないタブ(別のタブが既に保存先へ書き込める状態)で、保存先を変える操作を
 * しようとした場合に投げるエラー(計画Issue #174)。Comlink越しでもドメインエラーとして伝播する
 * (src/infrastructure/rpc/domainErrorRegistry.tsに登録済み)。
 */
export class ReadOnlyStorageError extends Error {
  constructor() {
    super('this tab cannot write to the storage because another tab holds the write lock')
    this.name = 'ReadOnlyStorageError'
  }
}
