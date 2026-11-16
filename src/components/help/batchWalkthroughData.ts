/**
 * 用語集の「精算バッチを例で詳しく見る」で見せる、旅行代30,000円をAのカードで払い友人Cと折半する例
 * (計画Issue #177、承認済みモックアップ④)の、段階ごとの仕訳の表と残高の表。
 * 説明の文章は辞書(locales/ja/help.json の batch.flow.stages)にあり、同じ添字で対応する。
 * 科目名は実画面の「区分・科目名」の表記に合わせる。
 */
export interface WalkthroughJournalRow {
  account: string
  member: string
  /** 'batch'はバッチ名のタグ、'unassigned'は「未割当」のタグ、nullは空欄 */
  batch: 'batch' | 'unassigned' | null
  debit: string
  credit: string
}

export interface WalkthroughBalanceRow {
  account: string
  member: string
  balance: string
  zero: boolean
}

export interface WalkthroughStage {
  settled: boolean
  journal: WalkthroughJournalRow[]
  balance: WalkthroughBalanceRow[]
}

export const BATCH_NAME = '26/7 友人Cと旅行'
const RECEIVABLE = '資産・未収金(精算バッチ)'
const DEPOSIT = '資産・口座(普通預金)'

export const WALKTHROUGH_STAGES: readonly WalkthroughStage[] = [
  {
    settled: false,
    journal: [
      { account: RECEIVABLE, member: 'A', batch: 'batch', debit: '15,000', credit: '' },
      { account: '費用・旅費', member: 'A', batch: null, debit: '', credit: '15,000' },
    ],
    balance: [{ account: RECEIVABLE, member: 'A', balance: '15,000', zero: false }],
  },
  {
    settled: false,
    journal: [
      { account: DEPOSIT, member: 'A', batch: null, debit: '15,000', credit: '' },
      { account: RECEIVABLE, member: 'A', batch: 'unassigned', debit: '', credit: '15,000' },
    ],
    balance: [{ account: RECEIVABLE, member: 'A', balance: '15,000', zero: false }],
  },
  {
    settled: true,
    journal: [
      { account: DEPOSIT, member: 'A', batch: null, debit: '15,000', credit: '' },
      { account: RECEIVABLE, member: 'A', batch: 'batch', debit: '', credit: '15,000' },
    ],
    balance: [{ account: RECEIVABLE, member: 'A', balance: '0', zero: true }],
  },
  {
    settled: true,
    journal: [
      { account: DEPOSIT, member: 'A', batch: null, debit: '14,500', credit: '' },
      { account: RECEIVABLE, member: 'A', batch: 'batch', debit: '', credit: '14,500' },
      { account: '費用・雑損失', member: 'A', batch: null, debit: '500', credit: '' },
      { account: RECEIVABLE, member: 'A', batch: 'batch', debit: '', credit: '500' },
    ],
    balance: [{ account: RECEIVABLE, member: 'A', balance: '0', zero: true }],
  },
]
