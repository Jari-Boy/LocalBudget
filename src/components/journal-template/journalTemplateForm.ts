import type { JournalTemplate, JournalTemplateLineInput, UpdateJournalTemplateInput } from '../../domain/journal-template/JournalTemplate'
import type { JournalEditorLine } from '../journal-entry/JournalEntryEditor'

/**
 * 仕訳テンプレートの編集フォームの状態(計画Issue #201)。名称・グループ・並び順は一覧側(GroupedMasterTab)が
 * 扱うため、ここは摘要・起票者・明細行だけを持つ。金額は入力途中の値をそのまま持てるよう文字列で、
 * 空欄は「起票時に入力する」を表す。純粋関数だけで、DB・DOMには依存しない。
 */
export interface JournalTemplateForm {
  memo: string
  /** 起票者の初期値。nullなら起票時に選ぶ */
  bookkeeperId: number | null
  lines: JournalEditorLine[]
}

/** テンプレートからフォームの状態を作る。行のkeyは1始まりの連番 */
export function templateFormFromTemplate(template: JournalTemplate): JournalTemplateForm {
  return {
    memo: template.memo ?? '',
    bookkeeperId: template.bookkeeperHouseholdMemberId,
    lines: template.lines.map((l, index) => ({
      key: index + 1,
      line: {
        accountId: l.accountId,
        side: l.side,
        amountInput: l.amount === null ? '' : String(l.amount),
        projectId: l.projectId,
        householdMemberId: l.householdMemberId,
        counterpartyId: l.counterpartyId,
        settlementBatchId: l.settlementBatchId,
      },
    })),
  }
}

/**
 * 金額の入力を整数に直す。全角数字・桁区切りのカンマ・前後の空白は数字として受け付ける。
 * 空欄はnull(起票時に入力)、正の整数でないものはNaN
 */
function parseAmountInput(input: string): number | null {
  const normalized = input.normalize('NFKC').replaceAll(',', '').trim()
  if (normalized === '') return null
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? Number(normalized) : Number.NaN
}

/** フォームを保存用の入力へ変換する。摘要が空白だけならnull(消去)、空欄の金額はnull */
export function buildTemplateUpdateInput(form: JournalTemplateForm): UpdateJournalTemplateInput {
  const lines: JournalTemplateLineInput[] = form.lines.map(({ line }) => ({
    side: line.side as 'debit' | 'credit',
    accountId: line.accountId as number,
    amount: parseAmountInput(line.amountInput),
    projectId: line.projectId,
    householdMemberId: line.householdMemberId,
    counterpartyId: line.counterpartyId,
    settlementBatchId: line.settlementBatchId ?? null,
  }))
  const memo = form.memo.trim()
  return {
    memo: memo === '' ? null : memo,
    bookkeeperHouseholdMemberId: form.bookkeeperId,
    lines,
  }
}

export type TemplateFormValidation = { valid: true } | { valid: false; reason: string }

/**
 * 保存できるかの検証(画面の入力支援。正式な検証はRepositoryが行う)。優先順に判定して最初の理由を返す。
 * 一部の行だけ金額があるときは、起票時に金額が決まるため貸借の一致を求めない。全行の金額があるときだけ、
 * 借方と貸方の合計の一致を求める。
 */
export function validateTemplateForm(form: JournalTemplateForm): TemplateFormValidation {
  const lines = form.lines.map((l) => l.line)
  if (lines.some((l) => l.accountId === null)) return { valid: false, reason: '科目が未選択の行があります' }
  if (!lines.some((l) => l.side === 'debit') || !lines.some((l) => l.side === 'credit')) {
    return { valid: false, reason: '借方と貸方の行がそれぞれ必要です' }
  }
  const amounts = lines.map((l) => parseAmountInput(l.amountInput))
  if (amounts.some((a) => a !== null && Number.isNaN(a))) {
    return { valid: false, reason: '金額は1以上の整数で入力してください' }
  }
  if (amounts.every((a) => a !== null)) {
    const total = (side: 'debit' | 'credit') =>
      lines.reduce((sum, l, i) => (l.side === side ? sum + (amounts[i] as number) : sum), 0)
    if (total('debit') !== total('credit')) return { valid: false, reason: '借方と貸方の合計が一致していません' }
  }
  return { valid: true }
}

/** 保存済みのテンプレートと内容が違うか。摘要の前後の空白・金額の書式(全角・カンマ)の違いは変更とみなさない */
export function isTemplateFormDirty(form: JournalTemplateForm, saved: JournalTemplate): boolean {
  const current = JSON.stringify(normalizedForCompare(form))
  const original = JSON.stringify(normalizedForCompare(templateFormFromTemplate(saved)))
  return current !== original
}

function normalizedForCompare(form: JournalTemplateForm) {
  return {
    memo: form.memo.trim(),
    bookkeeperId: form.bookkeeperId,
    lines: form.lines.map(({ line }) => ({
      side: line.side,
      accountId: line.accountId,
      amount: parseAmountInput(line.amountInput),
      projectId: line.projectId,
      householdMemberId: line.householdMemberId,
      counterpartyId: line.counterpartyId,
      settlementBatchId: line.settlementBatchId ?? null,
    })),
  }
}
