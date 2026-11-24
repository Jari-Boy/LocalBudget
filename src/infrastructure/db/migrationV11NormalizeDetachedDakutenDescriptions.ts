import type { MigrationStep } from './migrations'

/**
 * スキーマ v10 → v11(計画Issue #279): 取り込み済みの仕訳(source_type = 'external_import')の摘要 journal_entries.memo の
 * 「かな+空白+分離した濁点・半濁点」を、1文字にまとめた形(画面の表示と同じ規則)にする(表の形は変えない)。
 * 手入力など、取り込みでない仕訳は変えない。突合用の記録(external_transaction_refs.description)と外部取引ID
 * (external_id)は、CSVの値のまま変えない(取込済みの判定が崩れないように)。
 *
 * この差分は凍結されたバージョンの記録なので、規則は表示用の関数を呼ばず、この時点の規則をここに写して持つ。
 */
const KATAKANA_HYPHEN = /(?<=[゠-ヿ])[-‐-―−－ｰ]/g

const formatForDisplay = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(KATAKANA_HYPHEN, 'ー')
    .replace(/\s+(?=[゙゚])/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()

export const MIGRATION_V11_NORMALIZE_DETACHED_DAKUTEN_DESCRIPTIONS: readonly MigrationStep[] = [
  (db) => {
    const result = db.exec("SELECT id, memo FROM journal_entries WHERE source_type = 'external_import' AND memo IS NOT NULL")
    for (const [id, memo] of result[0]?.values ?? []) {
      const formatted = formatForDisplay(memo as string)
      if (formatted !== memo) db.run('UPDATE journal_entries SET memo = ? WHERE id = ?', [formatted, id as number])
    }
  },
]
