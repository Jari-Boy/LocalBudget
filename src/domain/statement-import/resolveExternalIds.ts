import type { ImportedRecord } from './ImportedRecord'

/**
 * バッチ(ImportedRecord[])から重複防止(docs/domain/statement-import.md 1.6)に使う外部取引ID列を
 * 解決する。CSVにexternal_id列があればそのまま使い、無ければentry_date/description/amountから
 * 同期の非暗号学的ハッシュ(djb2)を生成して代替する(1.2)。
 *
 * 暗号学的ハッシュ(Web Crypto SubtleCrypto等)を採用しない理由: 重複判定を純粋関数として
 * ユニットテストで検証するというTDD方針との相性(SubtleCryptoは非同期API)、および
 * ハッシュ衝突による誤検知はユーザーが明示的に選択して救済する設計(1.6)を既に前提にしているため。
 *
 * バッチ全体を入力とするのは、同一バッチ内に(entry_date, description, amount)が完全一致する
 * レコードが複数存在する場合(例: 同じコンビニで同じ商品を同日中に2回購入)に、単純な
 * レコード単体のハッシュでは同一のexternal_idになりUNIQUE(account_id, external_id)制約に
 * 違反してしまうため。出現順(バッチ内での並び順)のインデックスをハッシュ入力に混ぜ込むことで、
 * 同一内容の取引が複数回発生するケースでも正しく異なるIDを生成する。
 */
export function resolveExternalIds(records: readonly ImportedRecord[]): string[] {
  const occurrenceCounts = new Map<string, number>()

  return records.map((record) => {
    if (record.externalId !== null) {
      return record.externalId
    }

    const key = `${record.entryDate}|${record.description}|${record.amount}`
    const occurrence = occurrenceCounts.get(key) ?? 0
    occurrenceCounts.set(key, occurrence + 1)

    const hashInput = occurrence === 0 ? key : `${key}|#${occurrence + 1}`
    return djb2Hash(hashInput)
  })
}

/**
 * djb2ハッシュ(Daniel J. Bernsteinによる軽量な非暗号学的文字列ハッシュ)。
 * 32bit符号なし整数を8桁の16進文字列にして返す。
 */
function djb2Hash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
