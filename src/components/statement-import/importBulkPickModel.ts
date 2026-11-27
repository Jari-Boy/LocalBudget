import type { Account } from '../../domain/account/Account'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { applyBulkSetting, rowStatus, type BulkChange, type ImportRowState, type RowRecord } from './importRowModel'

/**
 * 明細取込の一括編集バーの「選んだ項目」と、その適用(計画Issue #300)。仕訳一覧の一括編集(journalBulkEditModel)と同じ操作モデルで、
 * 項目を「変更しない・外す・この値にする」で持ち、選択した行(科目を変えるなら変更後の科目)から選べる項目を先に決めて
 * 不正な操作をできなくする。適用の規則は既存の applyBulkSetting(importRowModel)を通し、行ごとの変更と同じ整合にする。
 * 重複・保存しない行は入力欄を持たないので、対象にしない。DB・DOM非依存の純粋関数。
 */

/** 1項目の選択。keep=変更しない、clear=外す(なしにする)、set=この値にする */
export type PickChange<T> = { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; value: T }

export interface ImportBulkPick {
  /** 相手科目。null=変更しない(相手科目は外せない) */
  counterAccountId: number | null
  project: PickChange<number>
  counterparty: PickChange<number>
  batch: PickChange<number>
  member: PickChange<number>
  /** コメント。空文字=変更しない(コメントを一括で消す操作は無い) */
  comment: string
}

export const EMPTY_IMPORT_BULK_PICK: ImportBulkPick = {
  counterAccountId: null,
  project: { kind: 'keep' },
  counterparty: { kind: 'keep' },
  batch: { kind: 'keep' },
  member: { kind: 'keep' },
  comment: '',
}

/** 何も選んでいない(すべて「変更しない」)か */
export function isImportBulkPickEmpty(pick: ImportBulkPick): boolean {
  return (
    pick.counterAccountId === null &&
    pick.project.kind === 'keep' &&
    pick.counterparty.kind === 'keep' &&
    pick.batch.kind === 'keep' &&
    pick.member.kind === 'keep' &&
    pick.comment === ''
  )
}

export interface ImportBulkRules {
  /** 選択した行のうち、一括編集の対象になる行数(重複・保存しない行を除く) */
  targetCount: number
  /** 選択したが対象外の行数(重複・保存しない行) */
  skippedCount: number
  accountAllowed: boolean
  projectAllowed: boolean
  commentAllowed: boolean
  /** 取引先を選べるか: 対象の行(科目を変えるなら変更後の科目)がすべて費用・収益、または科目が未選択 */
  counterpartyAllowed: boolean
  /** 精算バッチを選べるか: 対象の行がすべて一時勘定(立替金・未払金など) */
  batchAllowed: boolean
  /** 世帯メンバーを選べるか: 既定の世帯メンバーがある科目の行を含まない */
  memberAllowed: boolean
  /** 選べない理由になっている科目名(重複なし、選択した順) */
  counterpartyBlockedBy: string[]
  batchBlockedBy: string[]
  memberBlockedBy: string[]
}

const UNSELECTED_ACCOUNT = '(科目未選択)'

/** 選択した行と科目の選択から、選べる項目を求める。対象の行が0のときは、どの項目も選べない */
export function importBulkRules(params: {
  states: readonly ImportRowState[]
  records: readonly RowRecord[]
  selected: ReadonlySet<number>
  pick: ImportBulkPick
  accounts: readonly Account[]
}): ImportBulkRules {
  const { states, records, selected, pick, accounts } = params
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const targets: number[] = []
  let skippedCount = 0
  for (const index of selected) {
    const status = rowStatus(records[index], states[index])
    if (status === 'duplicate' || status === 'skipped') skippedCount++
    else targets.push(index)
  }

  const blockedBy = (isBlocked: (account: Account | undefined) => boolean): string[] => {
    const names: string[] = []
    for (const index of targets) {
      const accountId = pick.counterAccountId ?? states[index].counterAccountId
      const account = accountId === null ? undefined : accountById.get(accountId)
      if (!isBlocked(account)) continue
      const name = account?.name ?? UNSELECTED_ACCOUNT
      if (!names.includes(name)) names.push(name)
    }
    return names
  }
  const counterpartyBlockedBy = blockedBy((a) => a !== undefined && !isCounterpartyEligibleCategory(a.category))
  const batchBlockedBy = blockedBy((a) => a === undefined || !isSettlementBatchTaggableAccount(a))
  const memberBlockedBy = blockedBy((a) => a !== undefined && a.householdMemberId !== null)
  const any = targets.length > 0
  return {
    targetCount: targets.length,
    skippedCount,
    accountAllowed: any,
    projectAllowed: any,
    commentAllowed: any,
    counterpartyAllowed: any && counterpartyBlockedBy.length === 0,
    batchAllowed: any && batchBlockedBy.length === 0,
    memberAllowed: any && memberBlockedBy.length === 0,
    counterpartyBlockedBy,
    batchBlockedBy,
    memberBlockedBy,
  }
}

/** 選べなくなった項目の選択を「変更しない」に戻す(選べる項目は残す) */
export function sanitizeImportBulkPick(pick: ImportBulkPick, rules: ImportBulkRules): ImportBulkPick {
  const keep = { kind: 'keep' } as const
  return {
    counterAccountId: rules.accountAllowed ? pick.counterAccountId : null,
    project: rules.projectAllowed ? pick.project : keep,
    counterparty: rules.counterpartyAllowed ? pick.counterparty : keep,
    batch: rules.batchAllowed ? pick.batch : keep,
    member: rules.memberAllowed ? pick.member : keep,
    comment: rules.commentAllowed ? pick.comment : '',
  }
}

export interface ImportBulkApplyResult {
  states: ImportRowState[]
  /** 反映した行数 */
  applied: number
  /** 選択されていたが反映しなかった行数(重複・保存しない行) */
  skipped: number
}

const toValue = (change: PickChange<number>): number | null | undefined =>
  change.kind === 'keep' ? undefined : change.kind === 'clear' ? null : change.value

/**
 * 選んだ項目を、選択した対象行に反映する。「変更しない」の項目は触らない。相手科目を先に反映してから、取引先・
 * プロジェクト・世帯メンバー・精算バッチ・コメントを反映する(科目で持てる項目が決まるため。反映の規則は applyBulkSetting と同じ)。
 */
export function applyImportBulkPick(params: {
  states: readonly ImportRowState[]
  records: readonly RowRecord[]
  selected: ReadonlySet<number>
  accounts: readonly Account[]
  pick: ImportBulkPick
}): ImportBulkApplyResult {
  const { states, records, selected, accounts, pick } = params
  if (isImportBulkPickEmpty(pick)) return { states: [...states], applied: 0, skipped: 0 }

  const changes: BulkChange[] = []
  if (pick.counterAccountId !== null) changes.push({ field: 'counterAccount', value: pick.counterAccountId })
  const fields = [
    ['counterparty', toValue(pick.counterparty)],
    ['project', toValue(pick.project)],
    ['householdMember', toValue(pick.member)],
    ['settlementBatch', toValue(pick.batch)],
  ] as const
  for (const [field, value] of fields) {
    if (value !== undefined) changes.push({ field, value })
  }
  if (pick.comment !== '') changes.push({ field: 'comment', value: pick.comment })

  const next = changes.reduce((current, change) => applyBulkSetting({ states: current, records, selected, accounts, change }).states, [
    ...states,
  ])
  let applied = 0
  for (const index of selected) if (next[index] !== states[index]) applied++
  return { states: next, applied, skipped: selected.size - applied }
}
