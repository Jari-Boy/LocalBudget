import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { summarizeAccountsByCategory } from '../financial-statement/summarizeAccountsByCategory'
import type { Project } from './Project'

/**
 * 非アクティブ化提案の判定ロジック(docs/domain/projects.md 1.3節・1.5節)。
 * kind='settlement'のプロジェクトに紐づく資産・負債科目それぞれについて
 * calculateAccountBalanceの計算式(financial-statementドメインの
 * summarizeAccountsByCategory経由)を適用し、すべての科目残高が0になった
 * 「精算残高0」の状態を検出する。
 *
 * 紐づく資産・負債科目の明細が1件もない(未記帳)場合は、精算完了と区別する
 * ためfalseを返す(精算残高の定義がそもそも「紐づく資産・負債科目」の存在を
 * 前提としているため)。kind='event'のプロジェクトは常にfalseを返す。
 *
 * この関数は判定結果(boolean)を返すのみで、is_activeの変更は行わない。
 * 呼び出し側(UI層)が結果を見て非アクティブ化を提案するかどうかを決める。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function isSettlementBalanceZero(
  project: Project,
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
): boolean {
  if (project.kind !== 'settlement') return false

  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const projectLines = entries
    .flatMap((entry) => entry.lines)
    .filter((line) => line.projectId === project.id)

  const linkedAssetOrLiabilityLines = projectLines.filter((line) => {
    const category = accountsById.get(line.accountId)?.category
    return category === 'asset' || category === 'liability'
  })

  if (linkedAssetOrLiabilityLines.length === 0) return false

  const nonZeroAssets = summarizeAccountsByCategory(linkedAssetOrLiabilityLines, accounts, 'asset')
  const nonZeroLiabilities = summarizeAccountsByCategory(
    linkedAssetOrLiabilityLines,
    accounts,
    'liability',
  )

  return nonZeroAssets.length === 0 && nonZeroLiabilities.length === 0
}
