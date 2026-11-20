import { useMemo } from 'react'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { MemberSelect } from '../master/MemberSelect'

export interface JournalMemberSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベル)。表のセルでは「借方の世帯メンバー」のように側を含める */
  label: string
  members: readonly HouseholdMember[]
  /** 現在の世帯メンバーのid。未決定はnull */
  memberId: number | null
  /** 渡すと、世帯メンバーを決めない項目をこの名前で常に出す(定期仕訳のルールの行「起票者と同じ」)。無いときは、未決定のときだけ「選択してください」を出す */
  noneLabel?: string
  /** 科目の既定メンバー。メンバーがそれと違う(既定を後から変えて旧メンバーのまま残した)行にだけ渡し、旧メンバーと「(科目の既定)」の2つだけを選ばせる */
  defaultMember?: HouseholdMember
  disabled?: boolean
  onChange: (memberId: number | null) => void
}

/**
 * 仕訳の起票者・明細行の世帯メンバーを選ぶ欄(計画Issue #234)。MemberSelectに、仕訳の決まり(未決定の文言・「決めない」項目・
 * 科目の既定メンバーの扱い)を足したもの。無効なメンバーは現在の値のときだけ残る。
 */
export function JournalMemberSelect({ label, members, memberId, noneLabel, defaultMember, disabled, onChange }: JournalMemberSelectProps) {
  const defaultId = defaultMember?.id
  const defaultName = defaultMember?.name
  const onlyOldMember = useMemo(() => (defaultId === undefined ? undefined : (m: HouseholdMember) => m.id !== defaultId), [defaultId])
  const leadingOptions = useMemo(
    () => (defaultId === undefined ? undefined : [{ value: String(defaultId), label: `${defaultName ?? ''}(科目の既定)` }]),
    [defaultId, defaultName],
  )
  return (
    <MemberSelect
      label={label}
      members={members}
      filter={onlyOldMember}
      leadingOptions={leadingOptions}
      value={memberId === null ? '' : String(memberId)}
      onChange={(value) => onChange(value === '' ? null : Number(value))}
      emptyLabel={noneLabel ?? (memberId === null ? '選択してください' : undefined)}
      disabled={disabled}
    />
  )
}
