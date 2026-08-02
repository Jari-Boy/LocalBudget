/**
 * インポートされたファイルが有効なLocalBudgetのDBバックアップとして扱えない場合に
 * スローされるエラー(計画Issue #26)。sql.jsが読み込めないファイル形式の場合、および
 * 読み込めても想定テーブルが揃っていない場合(docs/architecture.md 8章、無関係な
 * sql.js DBファイルの誤インポート対策)の両方をこの型で表現する。呼び出し側は
 * instanceofで判定でき、Comlink越しでもドメインエラーとして伝播する
 * (src/infrastructure/rpc/domainErrorRegistry.tsに登録済み)。
 */
export class InvalidBackupFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBackupFileError'
  }
}
