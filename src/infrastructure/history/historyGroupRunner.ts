import type { OperationMeta } from './operationDetail'

/** 操作履歴のうち、バッチをまとめるのに必要な部分(RPC越しなのでPromiseを返してもよい) */
export interface HistoryGroupApi {
  beginGroup(label: string): void | Promise<void>
  endGroup(meta?: OperationMeta): void | Promise<void>
}

/**
 * 複数のRPC呼び出しからなるバッチ(CSV取込確定・割勘・精算など)を、操作履歴上1件の取消単位に
 * まとめて実行する(計画Issue #202)。成功・失敗のどちらでもグループを閉じる。
 * 履歴APIが渡されなければ(テスト等)関数だけを実行する。
 * getMetaを渡すと、関数の実行後(グループを閉じる直前)に呼び、返した値をその操作に添える(計画Issue #295)。
 * 実行の結果(確定できた件数など)から作る情報を渡すために、値ではなく関数で受ける。
 */
export async function runInHistoryGroup<T>(
  history: HistoryGroupApi | undefined,
  label: string,
  fn: () => Promise<T>,
  getMeta?: () => OperationMeta | undefined,
): Promise<T> {
  if (!history) return fn()
  await history.beginGroup(label)
  try {
    return await fn()
  } finally {
    await history.endGroup(getMeta?.())
  }
}
