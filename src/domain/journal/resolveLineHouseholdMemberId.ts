import type { Account } from '../account/Account'

/**
 * 明細行の世帯メンバーを決める関数。科目idと、呼び出し側が指定したい世帯メンバー(任意)から、
 * 保存する世帯メンバーを必ず1人に確定する。仕訳を組み立てるビルダーが受け取り、呼び出し側が
 * 科目と起票者から作って渡す(createLineHouseholdMemberResolver)。
 */
export type LineHouseholdMemberResolver = (accountId: number, requested?: number | null) => number

export interface ResolveLineHouseholdMemberIdParams {
  /** 科目の既定の世帯メンバー(accounts.household_member_id) */
  accountDefault: number | null
  /** 呼び出し側が指定した世帯メンバー。未指定ならnull/undefined */
  requested?: number | null
  /** 起票者(journal_entries.household_member_id) */
  entryMemberId: number
}

/**
 * 明細行に保存する世帯メンバーの決め方(docs/domain/household-members.md 1.2節、計画Issue #169)。
 * 科目の既定メンバー > 指定されたメンバー > 起票者 の順に採用する。科目に既定値がある行は
 * 上書きできない(DBトリガーも同じ規則で拒否する)ため、常に既定値が優先される。
 * 明細行は継承(NULL)をやめて常に実際の世帯メンバーを持つので、書き込み側は保存の前に
 * この関数で必ず確定させる。DB非依存の純粋関数。
 */
export function resolveLineHouseholdMemberId({
  accountDefault,
  requested,
  entryMemberId,
}: ResolveLineHouseholdMemberIdParams): number {
  return accountDefault ?? requested ?? entryMemberId
}

/** 科目の一覧と起票者から、LineHouseholdMemberResolverを作る。一覧にない科目は既定値なしとして扱う */
export function createLineHouseholdMemberResolver(
  accounts: ReadonlyArray<Pick<Account, 'id' | 'householdMemberId'>>,
  entryMemberId: number,
): LineHouseholdMemberResolver {
  const defaultByAccountId = new Map(accounts.map((a) => [a.id, a.householdMemberId]))
  return (accountId, requested) =>
    resolveLineHouseholdMemberId({
      accountDefault: defaultByAccountId.get(accountId) ?? null,
      requested,
      entryMemberId,
    })
}
