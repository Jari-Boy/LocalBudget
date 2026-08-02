/**
 * react-i18nextの初期化モジュール(i18n.ts)のユニットテスト。
 * i18nextインスタンスがcommon名前空間のリソース(src/locales/ja/common.json)を
 * 正しく読み込み、t()でキーから対応する日本語文字列を取得できることを検証する。
 * 外部依存なし(i18next/react-i18nextライブラリ自体のみ、DOM描画は伴わない)。
 */
import { describe, expect, test } from 'vitest'
import i18n from './i18n'
import common from '../../locales/ja/common.json'

describe('i18n', () => {
  test('日本語をデフォルト言語として初期化される', () => {
    expect(i18n.language).toBe('ja')
  })

  test('common名前空間のキーから対応する日本語文字列を取得できる', () => {
    expect(i18n.t('appName')).toBe(common.appName)
    expect(i18n.t('close')).toBe(common.close)
  })

  test('存在しないキーを指定した場合はキー自体を返す(i18nextの既定動作)', () => {
    expect(i18n.t('doesNotExist')).toBe('doesNotExist')
  })
})
