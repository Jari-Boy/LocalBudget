import { DEFAULT_LOCALE } from './locale'

/**
 * 日付をロケールに応じた表示用文字列に変換する。ドメイン層・DB層は日付を
 * ロケール依存の文字列として扱わず、この関数は表示直前にのみ呼び出す
 * (docs/architecture.md 13章)。
 */
export function formatDate(date: Date, locale: string = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale).format(date)
}
