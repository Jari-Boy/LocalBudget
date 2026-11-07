import type { CreateImportMappingDefinitionInput } from '../../domain/statement-import/ImportMappingDefinition'

/**
 * OSSとして同梱する主要金融機関向けの組み込みマッピング定義(docs/domain/statement-import.md
 * 2.3節「OSSとして主要金融機関向けの定義がアプリに同梱される想定」)。account_id = NULLの
 * 汎用定義として提供し、ユーザーが対象科目に対して初めて使うとその科目に紐づく(同2.3節)。
 * 列構成・日付形式・エンコーディングは実際のCSVサンプル(楽天カード確定/速報、楽天銀行、
 * PayPayカード確定)から確認した値を使用している。
 *
 * 楽天カードのCSVは末尾に日付列が空の特殊行(未確定明細の「■ご利用キャンセルなど」セクション、
 * 確定明細のETC利用区間情報の補足行)を含むことがあり、その行は日付を読み取れない。取込時は
 * その行を取り込み対象から外して「取り込まない行」に示すだけなので(計画Issue #151、
 * buildStatementImportReviewのunreadableRows)、CSVを加工せずに取り込める。
 */
export const BUILT_IN_MAPPING_DEFINITIONS: readonly CreateImportMappingDefinitionInput[] = [
  {
    formatGroupId: 'rakuten-card',
    isSettled: true,
    label: '楽天カード(確定明細)',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '利用日',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '利用店名・商品名',
    amountMode: 'single_signed',
    amountColumn: '利用金額',
  },
  {
    formatGroupId: 'rakuten-card',
    isSettled: false,
    label: '楽天カード(速報明細)',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '利用日',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '利用店名・商品名',
    amountMode: 'single_signed',
    amountColumn: '利用金額',
  },
  {
    formatGroupId: 'rakuten-bank',
    isSettled: null,
    label: '楽天銀行',
    encoding: 'shift-jis',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '取引日',
    dateFormat: 'YYYYMMDD',
    descriptionColumn: '入出金内容',
    amountMode: 'single_signed',
    amountColumn: '入出金(円)',
    balanceColumn: '取引後残高(円)',
  },
  {
    formatGroupId: 'paypay-card',
    isSettled: true,
    label: 'PayPayカード(確定明細)',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '利用日/キャンセル日',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '利用店名・商品名',
    amountMode: 'single_signed',
    amountColumn: '利用金額',
  },
]
