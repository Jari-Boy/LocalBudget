import { DEFAULT_LOCALE } from './locale'

/**
 * 通貨最小単位(例: JPYなら1円単位、USDなら1セント単位)の整数値を、
 * ISO 4217準拠の通貨コードとロケールに応じた表示用文字列に変換する。
 * ドメイン層・DB層では金額を最小単位の整数値としてのみ保持し、この関数は
 * 表示直前にのみ呼び出す(docs/architecture.md 13章、docs/domain/journal.md 1.4)。
 * 通貨ごとの小数桁数はIntl.NumberFormatのresolvedOptionsから取得するため、
 * 桁数テーブルを自前で持たない。
 */
export function formatCurrency(
  minorUnitAmount: number,
  currencyCode: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  })
  const { maximumFractionDigits: fractionDigits } = formatter.resolvedOptions()
  if (fractionDigits === undefined) {
    throw new Error(`maximumFractionDigitsを解決できませんでした(currency: ${currencyCode})`)
  }
  const majorUnitAmount = minorUnitAmount / 10 ** fractionDigits
  return formatter.format(majorUnitAmount)
}
