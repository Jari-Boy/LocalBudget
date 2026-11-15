import type { JournalTemplate } from './JournalTemplate'

/**
 * テンプレート一覧の「内容」の表示(計画Issue #201)。借方の科目と貸方の科目を「 / 」で並べる。
 * 同じ側に複数の科目があるときは出現順に「・」でつなぎ、重複は1つにする。一覧に無い科目は「不明な科目」。
 * DB・DOM非依存の純粋関数。
 */
export function describeTemplateContent(
  template: Pick<JournalTemplate, 'lines'>,
  accountNameById: ReadonlyMap<number, string>,
): string {
  const namesOf = (side: 'debit' | 'credit') => {
    const names: string[] = []
    for (const line of template.lines) {
      if (line.side !== side) continue
      const name = line.accountId === null ? '科目未設定' : (accountNameById.get(line.accountId) ?? '不明な科目')
      if (!names.includes(name)) names.push(name)
    }
    return names.join('・')
  }
  return `${namesOf('debit')} / ${namesOf('credit')}`
}

export type TemplateAmountSummary =
  | { kind: 'fixed'; total: number }
  | { kind: 'input' }
  | { kind: 'partial' }

/**
 * テンプレートの金額の状態。全行の金額があれば固定(借方の合計)、全行が空欄なら起票時に入力、
 * 一部だけあれば一部入力。表示用の文字列への変換は呼び出し側(通貨の書式)が行う。
 */
export function summarizeTemplateAmount(template: Pick<JournalTemplate, 'lines'>): TemplateAmountSummary {
  const filled = template.lines.filter((l) => l.amount !== null)
  if (filled.length === 0) return { kind: 'input' }
  if (filled.length < template.lines.length) return { kind: 'partial' }
  const total = template.lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum + (l.amount as number), 0)
  return { kind: 'fixed', total }
}
