import type { MigrationStep } from './migrations'
import { normalizeKeywordRules } from './migrationV3NormalizeKeywords'

/**
 * スキーマ v9 → v10(計画Issue #279): キーワードマスタ keyword_rules.pattern を、「かな+空白+分離した濁点・半濁点」を
 * 1文字にまとめる(空白を取り除いたあとにNFCをかける)照合用の正規化にそろえ直す(表の形は変えない)。
 * 重なったときは、v3・v4・v7と同じ手順で1件にまとめる(別の取引先のものは、どちらも残す)。
 *
 * この差分は凍結されたバージョンの記録なので、規則は照合用の関数を呼ばず、この時点の規則をここに写して持つ。
 */
const KATAKANA_HYPHEN = /(?<=[゠-ヿ])[-‐-―−－ｰ]/g
const SMALL_TO_LARGE: Readonly<Record<string, string>> = {
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ',
}

const normalizeForMatching = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (ch) => SMALL_TO_LARGE[ch])
    .replace(KATAKANA_HYPHEN, 'ー')
    .toUpperCase()
    .replace(/\s+/g, '')
    .normalize('NFC')

export const MIGRATION_V10_NORMALIZE_DETACHED_DAKUTEN_KEYWORDS: readonly MigrationStep[] = [
  (db) => normalizeKeywordRules(db, normalizeForMatching),
]
