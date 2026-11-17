import type { Database } from 'sql.js'
import type { MigrationStep } from './migrations'

/**
 * スキーマ v2 → v3: キーワードマスタ keyword_rules.pattern を、照合用の正規化(NFKC・大文字化・空白除去)にそろえる。
 * 表の形は変えない(データ変換のみ)。画面は摘要の半角カナ・全角英数を標準化して表示し、キーワードは正規化して保存するため、
 * 以前に正規化せず保存されたキーワード(半角カナ等)が、摘要に当たらない・同じ意味で複数登録される、という状態を解消する。
 *
 * 標準化すると同じになるキーワードが重なったときは、次のとおり1件にまとめる(docs/guides/schema-migration.md 4.3)。
 * - 同じ取引先のキーワード同士、取引先を持たない同じ科目のキーワード同士は、1件にする。残すのは、科目付きを優先し、
 *   同じなら id が小さい方。
 * - 別の取引先(や別の科目)のキーワードは、同じ文字列になってもどちらも残す(どちらに寄せるかを移行では決めない)。
 *
 * この差分は凍結されたバージョンの記録なので、正規化の規則は照合用の関数(normalizeDescriptionForMatching)を呼ばず、
 * この時点の規則をここに写して持つ。
 */
const normalize = (text: string): string => text.normalize('NFKC').toUpperCase().replace(/\s+/g, '')

interface Row {
  id: number
  pattern: string
  counterpartyId: number | null
  accountId: number | null
}

export const MIGRATION_V3_NORMALIZE_KEYWORDS: readonly MigrationStep[] = [(db) => normalizeKeywordRules(db, normalize)]

/**
 * keyword_rules.pattern を normalize にそろえ、重なるキーワードをまとめる(v3・v4で共通の手順)。
 * 規則(normalize)は、各バージョンの時点のものを呼び出し側が渡す。
 */
export function normalizeKeywordRules(db: Database, normalize: (text: string) => string): void {
  {
    const result = db.exec('SELECT id, pattern, counterparty_id, account_id FROM keyword_rules ORDER BY id')
    const rows: Row[] = (result[0]?.values ?? []).map((v) => ({
      id: v[0] as number,
      pattern: v[1] as string,
      counterpartyId: v[2] as number | null,
      accountId: v[3] as number | null,
    }))

    // 重なりの単位: 取引先のキーワードは(取引先, 正規化後)、科目だけのキーワードは(科目, 正規化後)
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
      const owner = row.counterpartyId !== null ? `c${row.counterpartyId}` : `a${row.accountId}`
      const key = `${owner}|${normalize(row.pattern)}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }

    for (const group of groups.values()) {
      // 科目付きを優先し、同じなら id が小さい方を残す(rowsはid順)
      const keep = group.find((r) => r.accountId !== null) ?? group[0]
      for (const row of group) {
        if (row !== keep) db.run('DELETE FROM keyword_rules WHERE id = ?', [row.id])
      }
      const normalized = normalize(keep.pattern)
      if (normalized !== keep.pattern) db.run('UPDATE keyword_rules SET pattern = ? WHERE id = ?', [normalized, keep.id])
    }
  }
}
