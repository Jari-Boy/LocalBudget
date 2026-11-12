import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'
import master from '../../locales/ja/master.json'
import journal from '../../locales/ja/journal.json'
import statementImport from '../../locales/ja/statementImport.json'
import expenseSplitting from '../../locales/ja/expenseSplitting.json'
import recurringTransaction from '../../locales/ja/recurringTransaction.json'
import analysis from '../../locales/ja/analysis.json'
import settings from '../../locales/ja/settings.json'

/**
 * ドメイン別の名前空間(account.json等)は、それぞれのUI実装Issue(D1〜D10、
 * #31〜#40)側が着手時に`resources.ja`へ追加する方針(計画Issue #29)。
 * journal名前空間は計画Issue #32(マニュアル仕訳入力UI)で追加した。
 * statementImport名前空間は計画Issue #76(CSV取込〜レビュー一覧の基盤)で追加した。
 * financialStatement名前空間は計画Issue #34(財務諸表PL/BS表示UI)で追加したが、計画Issue #155で分析画面(analysis名前空間)に置き換えて削除した。
 * expenseSplitting名前空間は計画Issue #40(割勘/精算UI)で追加した。
 * master名前空間は計画Issue #118で新設し、計画Issue #154でマスタ画面(勘定科目・取引先・世帯メンバー・
 * プロジェクト・定期仕訳の5タブ)の文言を1つの名前空間にまとめた。このとき、旧マスタ画面専用だった
 * account・accountGroup・counterparty・householdMember・project名前空間は未使用になったため削除した。
 * recurringTransaction名前空間は計画Issue #39で追加した。現在は提案レビュー画面と、繰り返しの表記
 * (describeRecurringSchedule)が使う(ルールの編集画面はmaster名前空間、計画Issue #154)。
 * analysis名前空間は計画Issue #155(分析画面の刷新)で追加した。
 * settings名前空間は計画Issue #173(設定画面とバックアップの書き出し・読み込み)で追加した。
 */
void i18n.use(initReactI18next).init({
  lng: 'ja',
  fallbackLng: 'ja',
  defaultNS: 'common',
  resources: {
    ja: {
      common,
      master,
      journal,
      statementImport,
      expenseSplitting,
      recurringTransaction,
      analysis,
      settings,
    },
  },
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
