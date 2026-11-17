import type { MigrationStep } from './migrations'
import { normalizeKeywordRules } from './migrationV3NormalizeKeywords'

/**
 * スキーマ v3 → v4: 摘要の標準化の続き(表の形は変えない)。
 * (1) 取り込み済みの仕訳(source_type = 'external_import')の摘要 journal_entries.memo を、半角カナ・全角英数・
 *     カタカナにつづくハイフンを標準化した形(画面の表示と同じ規則)にする。手入力など、取り込みでない仕訳は変えない。
 *     突合用の記録(external_transaction_refs.description)と外部取引ID(external_id)は、CSVの値のまま変えない
 *     (取込済みの判定が崩れないように)。
 * (2) キーワードマスタ keyword_rules.pattern を、v3の規則にカタカナにつづくハイフンの標準化を加えた規則にそろえ直す
 *     (v3の時点では、ハイフンを標準化していなかった)。重なったときのまとめ方はv3と同じ。
 *
 * この差分は凍結されたバージョンの記録なので、規則は表示・照合用の関数を呼ばず、この時点の規則をここに写して持つ。
 */
const KATAKANA_HYPHEN = /(?<=[゠-ヿ])[-‐-―−－ｰ]/g

const formatForDisplay = (text: string): string => text.normalize('NFKC').replace(KATAKANA_HYPHEN, 'ー').replace(/\s+/g, ' ').trim()
const normalizeForMatching = (text: string): string => text.normalize('NFKC').replace(KATAKANA_HYPHEN, 'ー').toUpperCase().replace(/\s+/g, '')

export const MIGRATION_V4_NORMALIZE_DESCRIPTIONS: readonly MigrationStep[] = [
  (db) => {
    const result = db.exec("SELECT id, memo FROM journal_entries WHERE source_type = 'external_import' AND memo IS NOT NULL")
    for (const [id, memo] of result[0]?.values ?? []) {
      const formatted = formatForDisplay(memo as string)
      if (formatted !== memo) db.run('UPDATE journal_entries SET memo = ? WHERE id = ?', [formatted, id as number])
    }
  },
  (db) => normalizeKeywordRules(db, normalizeForMatching),
]
