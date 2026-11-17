import type { Database } from 'sql.js'
import type { AccountCategory, SystemRole } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

interface EnsureSystemRoleAccountInput {
  role: SystemRole
  category: AccountCategory
  /** 新規に投入するときの科目名。役割が付いた後に利用者が改名してもよい */
  name: string
  /**
   * 役割のまだ無い既存科目のうち、この役割を付けてよいものの条件(旧データ向け)。
   * 該当が複数あれば、idの小さい(古い)ものを選ぶ
   */
  isLegacyCandidate: (account: ReturnType<SqlJsAccountRepository['findAll']>[number]) => boolean
}

/**
 * 役割(system_role)を持つシステム管理科目を1件だけ、冪等に用意する(計画Issue #223)。
 * 1. その役割の科目が既にあれば何もしない(改名されていても再投入しない)
 * 2. 無ければ、役割の無い旧データの該当科目にシステム管理と役割を付与する(過去の仕訳はそのまま)
 * 3. それも無ければ新規に投入する
 * 本番前の運用ではスキーマの差分を足さないため、旧データへの役割の付与はこの起動時の投入で行う。
 */
export function ensureSystemRoleAccount(db: Database, input: EnsureSystemRoleAccountInput): void {
  const repository = new SqlJsAccountRepository(db)
  const accounts = repository.findAll()

  if (accounts.some((account) => account.systemRole === input.role)) return

  const legacy = accounts.find(
    (account) =>
      account.category === input.category &&
      account.isActive &&
      (account.systemRole ?? null) === null &&
      input.isLegacyCandidate(account),
  )
  if (legacy) {
    db.run('UPDATE accounts SET is_system_managed = 1, system_role = ? WHERE id = ?', [input.role, legacy.id])
    return
  }

  repository.create({
    category: input.category,
    name: input.name,
    isReconcilable: null,
    isSystemManaged: true,
    systemRole: input.role,
  })
}
