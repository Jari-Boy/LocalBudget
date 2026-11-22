import type { MigrationStep } from './migrations'
import { normalizeKeywordRules } from './migrationV3NormalizeKeywords'

/**
 * スキーマ v6 → v7(計画Issue #236): キーワードマスタ keyword_rules.pattern を、ひらがなをカタカナに、
 * カタカナ・ひらがなの小書き文字を大きい文字にそろえた照合用の正規化にそろえ直す(表の形は変えない)。
 * 照合で「ジェイアール」と「ジエイアール」の区別をしなくなったため、以前に別々に登録されたキーワードが
 * 同じ取引先で重なったときは、v3・v4と同じ手順で1件にまとめる(別の取引先のものは、どちらも残す)。
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

export const MIGRATION_V7_NORMALIZE_KANA_KEYWORDS: readonly MigrationStep[] = [(db) => normalizeKeywordRules(db, normalizeForMatching)]
