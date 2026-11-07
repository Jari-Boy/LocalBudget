/**
 * グラフの系列色(計画Issue #150)。承認済みモックアップの色を、dataviz スキルの
 * 検証スクリプト(validate_palette.js)にかけて確認した値。
 *
 *   node validate_palette.js "#2A78D6,#EB6834,#1BAF7A,#EDA100,#E87BA4" --mode light --surface "#FFFFFF"
 *   [PASS] 明度の帯 / 彩度の下限 / 色覚多様性での隣接差(最小 ΔE 9.1) / 通常視覚での差(最小 ΔE 19.6)
 *   [WARN] 面とのコントラスト(#1BAF7A 2.82, #EDA100 2.17, #E87BA4 2.69 が3:1未満)
 *
 * コントラストの警告は「凡例・直接ラベル・数値の表のいずれかで色に頼らず識別できること」が条件。
 * Chart は凡例(2系列以上)・ツールチップ・表で見るビューを必ず持つことでこの条件を満たす。
 * 系列は固定の順序で割り当て(循環させない)、系列数が多いときは新しい色を作らず「その他」にまとめる。
 * ダークモードは未対応(アプリ全体が未対応のため)。対応するときは同じスクリプトを --mode dark で再検証する。
 */
export const CHART_SERIES_COLORS = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4'] as const

export const CHART_OTHER_COLOR = '#898781'

export function colorForSeries(index: number): string {
  return CHART_SERIES_COLORS[index] ?? CHART_OTHER_COLOR
}
