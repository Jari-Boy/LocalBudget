import type { AccountCategory } from '../../domain/account/Account'
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import { isCounterpartyEligibleCategory, type JournalEntryFormLine } from './journalEntryFormLine'

/**
 * テンプレートを新規仕訳フォームへ展開したときの警告(計画Issue #201)。
 * lineNoは1始まりの行番号で、起票者(bookkeeper)の警告はnull。
 */
export interface TemplateExpansionWarning {
  lineNo: number | null
  kind: 'account' | 'counterparty' | 'project' | 'member' | 'bookkeeper'
  name: string
}

export interface ExpandJournalTemplateParams {
  template: JournalTemplate
  /** 展開した仕訳の日付(YYYY-MM-DD)。テンプレートは日付を持たないため、呼び出し側が今日を渡す */
  today: string
  accounts: ReadonlyArray<{
    id: number
    name: string
    category: AccountCategory
    isActive: boolean
    householdMemberId: number | null
  }>
  members: ReadonlyArray<{ id: number; name: string; isActive: boolean }>
  projects: ReadonlyArray<{ id: number; name: string; isActive: boolean }>
  counterparties: ReadonlyArray<{ id: number; name: string; isActive: boolean }>
}

export interface JournalTemplateExpansion {
  entryDate: string
  memo: string
  comment: string
  householdMemberId: number | null
  lines: JournalEntryFormLine[]
  warnings: TemplateExpansionWarning[]
}

/**
 * テンプレートを「新規仕訳」フォームの初期値へ展開する純粋関数(計画Issue #201)。
 * 日付は今日、コメントは空、摘要はテンプレートの摘要、金額の空欄は空文字。起票者はテンプレートの指定
 * (無効なら最初の有効なメンバー)で、行の世帯メンバーは 科目の既定 > 行の指定 > 起票者 の順で決める
 * (resolveLineHouseholdMemberIdと同じ優先順)。取引先はPL科目の行だけに残す。
 * 無効な(または一覧に無い)科目・取引先・プロジェクト・世帯メンバーは、不正な値をフォームに入れず空にして
 * 警告として返す。科目が空の行は、既存の入力チェックにより確定できない。DB・DOM非依存。
 */
export function expandJournalTemplate(params: ExpandJournalTemplateParams): JournalTemplateExpansion {
  const { template, today } = params
  const accountById = new Map(params.accounts.map((a) => [a.id, a]))
  const memberById = new Map(params.members.map((m) => [m.id, m]))
  const projectById = new Map(params.projects.map((p) => [p.id, p]))
  const counterpartyById = new Map(params.counterparties.map((c) => [c.id, c]))
  const warnings: TemplateExpansionWarning[] = []

  const firstMember = params.members.find((m) => m.isActive)?.id ?? null
  let bookkeeper = firstMember
  if (template.bookkeeperHouseholdMemberId !== null) {
    const member = memberById.get(template.bookkeeperHouseholdMemberId)
    if (member?.isActive) {
      bookkeeper = member.id
    } else {
      warnings.push({ lineNo: null, kind: 'bookkeeper', name: member?.name ?? '不明なメンバー' })
    }
  }

  const lines = template.lines.map((line): JournalEntryFormLine => {
    const account = accountById.get(line.accountId)
    const accountUsable = account?.isActive === true
    if (!accountUsable) {
      warnings.push({ lineNo: line.lineNo, kind: 'account', name: account?.name ?? '不明な科目' })
    }

    let projectId: number | null = null
    if (line.projectId !== null) {
      const project = projectById.get(line.projectId)
      if (project?.isActive) projectId = project.id
      else warnings.push({ lineNo: line.lineNo, kind: 'project', name: project?.name ?? '不明なプロジェクト' })
    }

    let counterpartyId: number | null = null
    if (line.counterpartyId !== null && account !== undefined && isCounterpartyEligibleCategory(account.category)) {
      const counterparty = counterpartyById.get(line.counterpartyId)
      if (counterparty?.isActive) counterpartyId = counterparty.id
      else warnings.push({ lineNo: line.lineNo, kind: 'counterparty', name: counterparty?.name ?? '不明な取引先' })
    }

    let requestedMember: number | null = null
    if (line.householdMemberId !== null) {
      const member = memberById.get(line.householdMemberId)
      if (member?.isActive) requestedMember = member.id
      else warnings.push({ lineNo: line.lineNo, kind: 'member', name: member?.name ?? '不明なメンバー' })
    }

    return {
      accountId: accountUsable ? line.accountId : null,
      side: line.side,
      amountInput: line.amount === null ? '' : String(line.amount),
      projectId,
      householdMemberId: account?.householdMemberId ?? requestedMember ?? bookkeeper,
      counterpartyId,
      settlementBatchId: line.settlementBatchId,
    }
  })

  return {
    entryDate: today,
    memo: template.memo ?? '',
    comment: '',
    householdMemberId: bookkeeper,
    lines,
    warnings,
  }
}

/** 展開時の警告を、画面に出す日本語の文にする。警告が無ければ空配列 */
export function describeTemplateExpansionWarnings(warnings: readonly TemplateExpansionWarning[]): string[] {
  return warnings.map((w) => {
    switch (w.kind) {
      case 'account':
        return `${w.lineNo}行目の科目「${w.name}」は使えないため、選び直してください`
      case 'counterparty':
        return `${w.lineNo}行目の取引先「${w.name}」は無効のため、空にしました`
      case 'project':
        return `${w.lineNo}行目のプロジェクト「${w.name}」は無効のため、空にしました`
      case 'member':
        return `${w.lineNo}行目の世帯メンバー「${w.name}」は無効のため、起票者にしました`
      case 'bookkeeper':
        return `起票者「${w.name}」は無効のため、別のメンバーにしました`
    }
  })
}
