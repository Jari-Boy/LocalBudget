/**
 * 金融機関名(import_mapping_definitions.format_group_id)の扱いを検証する純粋関数の
 * ユニットテスト(計画Issue #183)。
 * - normalizeFinancialInstitutionName: 保存前の表記ゆれ吸収(NFKC正規化・空白の除去)
 * - collectFinancialInstitutionNames: 既存定義と組み込み定義から選択候補を重複なく集める
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { collectFinancialInstitutionNames, normalizeFinancialInstitutionName } from './financialInstitution'

describe('normalizeFinancialInstitutionName', () => {
  it('前後の空白を取り除く', () => {
    expect(normalizeFinancialInstitutionName('  楽天カード  ')).toBe('楽天カード')
  })

  it('全角英数字を半角にそろえる', () => {
    expect(normalizeFinancialInstitutionName('ＰａｙＰａｙカード')).toBe('PayPayカード')
  })

  it('半角カナを全角カナにそろえる', () => {
    expect(normalizeFinancialInstitutionName('ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ')).toBe('ミツイスミトモカード')
  })

  it('名前の途中の空白(全角・半角)も取り除く', () => {
    expect(normalizeFinancialInstitutionName('楽天 カード')).toBe('楽天カード')
    expect(normalizeFinancialInstitutionName('楽天　カード')).toBe('楽天カード')
  })

  it('空白だけの入力は空文字になる', () => {
    expect(normalizeFinancialInstitutionName(' 　 ')).toBe('')
  })
})

describe('collectFinancialInstitutionNames', () => {
  it('重複を取り除いて照合順(英字→かな)に並べる', () => {
    expect(collectFinancialInstitutionNames(['ゆうちょ', 'PayPayカード', 'ゆうちょ', 'あおぞら'])).toEqual([
      'PayPayカード',
      'あおぞら',
      'ゆうちょ',
    ])
  })

  it('表記ゆれ(全角半角・空白)は同じ名前として1件にまとめる', () => {
    expect(collectFinancialInstitutionNames(['ＰａｙＰａｙカード', 'PayPayカード', ' PayPay カード'])).toEqual(['PayPayカード'])
  })

  it('空の名前は候補に含めない', () => {
    expect(collectFinancialInstitutionNames(['', '  ', '楽天銀行'])).toEqual(['楽天銀行'])
  })
})
