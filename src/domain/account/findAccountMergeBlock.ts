import type { Account } from './Account'

/** 統合できない理由。統合できるときは null */
export type AccountMergeBlock = 'systemManaged' | 'differentCategory' | 'differentReconcilability'

/**
 * 複数の勘定科目を1つに統合できるかを判定する(docs/domain/accounts.md 2.2、計画Issue #97)。
 * システム管理科目を含む・区分が異なる・照合可否が異なる、のいずれかなら理由を返す。
 * SqlJsAccountRepository.merge の拒否条件と同じ規則(統合先が有効であることの検証はそちらと
 * UIの統合先の選択肢で行う)。
 */
export function findAccountMergeBlock(accounts: readonly Account[]): AccountMergeBlock | null {
  if (accounts.some((a) => a.isSystemManaged)) return 'systemManaged'
  const [first, ...rest] = accounts
  if (rest.some((a) => a.category !== first.category)) return 'differentCategory'
  if (rest.some((a) => a.isReconcilable !== first.isReconcilable)) return 'differentReconcilability'
  return null
}
