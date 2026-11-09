import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'

export const yen = (value: number) => formatCurrency(value, 'JPY')

/** 差額・収支など、増減を示す金額。プラスには「+」を付ける。 */
export const signedYen = (value: number) => (value > 0 ? `+${yen(value)}` : yen(value))

/** 縦軸の目盛り用の短い表記(1万円以上は「N万」)。 */
export const compactYen = (value: number) => {
  const abs = Math.abs(value)
  const text = abs >= 10000 ? `${(abs / 10000).toLocaleString('ja-JP')}万` : String(abs)
  return value < 0 ? `-${text}` : text
}
