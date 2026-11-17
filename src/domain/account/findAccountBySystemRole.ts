import type { Account, SystemRole } from './Account'

/**
 * 科目一覧から、名前ではなく役割(systemRole)で科目を引く(計画Issue #223)。
 * 同じ役割の科目は1件だけなので、最初に見つかったものを返す。無ければnull。
 */
export function findAccountBySystemRole<T extends Pick<Account, 'systemRole'>>(
  accounts: readonly T[],
  role: SystemRole,
): T | null {
  return accounts.find((account) => account.systemRole === role) ?? null
}
