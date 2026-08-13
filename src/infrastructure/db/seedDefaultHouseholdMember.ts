import type { Database } from 'sql.js'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'

const DEFAULT_HOUSEHOLD_MEMBER_NAME = '自分'

/**
 * household_membersが1件も登録されていない状態でデフォルトメンバーを1件自動投入する
 * (docs/domain/household-members.md 1.2節、計画Issue #88)。0件になりうる主な理由は
 * 初回起動時だが、投入後にユーザーが唯一のメンバーを削除して0件に戻した場合も対象になる
 * (この場合は次回起動時に別のデフォルトメンバーが再投入される、計画Issueの懸念点参照)。
 * デフォルトメンバーはis_system_managedのような保護を持たない通常のメンバーとして作成し、
 * 改名・削除を妨げない。seedBuiltInMappingDefinitions(docs/domain/statement-import.md 2.3節)
 * と同じくWorker起動のたびに呼ばれても冪等であり、db.worker.tsからrunMigrations直後に呼び出す。
 */
export function seedDefaultHouseholdMember(db: Database): void {
  const repository = new SqlJsHouseholdMemberRepository(db)
  if (repository.findAll().length > 0) return

  repository.create({ name: DEFAULT_HOUSEHOLD_MEMBER_NAME })
}
