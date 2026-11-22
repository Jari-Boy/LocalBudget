/**
 * 明細取込の一時保存(計画Issue #231 フェーズ3、docs/domain/statement-import.md 1.8)。
 * 件数が多いCSVを1回で入力しきれないときに、取込作業を途中で中断し、後から続きを再開するための記録。
 * 保存するのは、CSVの生データ・マッピング定義・取込先・取り込むファイルの選択・「誰の明細か」と、行ごとの入力内容
 * (外部取引IDごとに、初期値から変えた項目だけ)。重複判定・似た取引の候補・残高照合の結果は保存せず、再開時に
 * いまの帳簿で計算し直す(保存した入力だけをその上に重ねる)。
 */

/** 似た取引がある行の扱い(importRowModel の ApproximateDecision と同じ値) */
export type StatementImportDraftApproximateDecision = 'different_transaction' | 'confirmed_replacement' | 'skip'

/**
 * 1行ぶんの保存する入力。取り込んだ直後の初期値(キーワードルールによる推定など)から変えた行だけを、
 * 外部取引IDをキーに持つ。参照先(科目・取引先・プロジェクトなど)は外部キーを張れないので、再開時に存在を検証する。
 */
export interface StatementImportDraftRowInput {
  counterpartyId: number | null
  counterAccountId: number | null
  counterAccountTouched: boolean
  projectId: number | null
  householdMemberId: number | null
  settlementBatchId: number | null
  comment: string
  includeDuplicate: boolean
  approximateDecision: StatementImportDraftApproximateDecision
  replacementTargetId: number | null
}

/** 一時保存したCSV1ファイル。取り込んだ全ファイルを選んだ順に持つ */
export interface StatementImportDraftFile {
  fileName: string
  bytes: Uint8Array
  /** 取り込むファイルとしてチェックしていたか */
  isChecked: boolean
}

/** 開始状態の一覧に出す要約(CSVの生データは含めない) */
export interface StatementImportDraftSummary {
  id: number
  targetAccountId: number
  /** 保存時のマッピング定義。削除されていればnull */
  definitionId: number | null
  fileNames: string[]
  /** 保存時点の取り込み対象の全件数 */
  totalRows: number
  /** そのうち、投入できた(相手科目が決まっている)件数 */
  filledRows: number
  createdAt: string
  /** 最後に保存した日時('YYYY-MM-DD HH:MM:SS'、UTC) */
  updatedAt: string
}

export interface StatementImportDraft {
  id: number
  targetAccountId: number
  definitionId: number | null
  /** 「誰の明細か」。取込先の科目に名義があるとき、または保存時に選んでいないときはnull */
  ownerMemberId: number | null
  files: StatementImportDraftFile[]
  /** 外部取引ID → 初期値から変えた入力 */
  rowInputs: Record<string, StatementImportDraftRowInput>
  totalRows: number
  filledRows: number
  createdAt: string
  updatedAt: string
}

export interface SaveStatementImportDraftInput {
  targetAccountId: number
  definitionId: number | null
  ownerMemberId: number | null
  files: StatementImportDraftFile[]
  rowInputs: Record<string, StatementImportDraftRowInput>
  totalRows: number
  filledRows: number
}
