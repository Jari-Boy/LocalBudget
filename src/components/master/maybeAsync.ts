/**
 * Repositoryのメソッドを、sql.js直接呼び出し(同期)・Web Worker越しのComlink RPC(非同期)の
 * どちらからでも受け取れるようにする型(docs/architecture.md 5章)。各メソッドの戻り値を
 * `R | Promise<R>`に広げる。画面は`await`で受けるため、どちらでも同じに扱える。
 */
export type MaybeAsync<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : T[K]
}
