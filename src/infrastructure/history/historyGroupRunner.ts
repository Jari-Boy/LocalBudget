/** 操作履歴のうち、バッチをまとめるのに必要な部分(RPC越しなのでPromiseを返してもよい) */
export interface HistoryGroupApi {
  beginGroup(label: string): void | Promise<void>
  endGroup(): void | Promise<void>
}

/**
 * 複数のRPC呼び出しからなるバッチ(CSV取込確定・割勘・精算など)を、操作履歴上1件の取消単位に
 * まとめて実行する(計画Issue #202)。成功・失敗のどちらでもグループを閉じる。
 * 履歴APIが渡されなければ(テスト等)関数だけを実行する。
 */
export async function runInHistoryGroup<T>(
  history: HistoryGroupApi | undefined,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!history) return fn()
  await history.beginGroup(label)
  try {
    return await fn()
  } finally {
    await history.endGroup()
  }
}
