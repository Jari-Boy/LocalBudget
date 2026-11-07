import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'
import master from '../../locales/ja/master.json'
import journal from '../../locales/ja/journal.json'
import statementImport from '../../locales/ja/statementImport.json'
import financialStatement from '../../locales/ja/financial-statement.json'
import expenseSplitting from '../../locales/ja/expenseSplitting.json'
import recurringTransaction from '../../locales/ja/recurringTransaction.json'

/**
 * ドメイン別の名前空間(account.json等)は、それぞれのUI実装Issue(D1〜D10、
 * #31〜#40)側が着手時に`resources.ja`へ追加する方針(計画Issue #29)。
 * journal名前空間は計画Issue #32(マニュアル仕訳入力UI)で追加した。
 * statementImport名前空間は計画Issue #76(CSV取込〜レビュー一覧の基盤)で追加した。
 * financialStatement名前空間は計画Issue #34(財務諸表PL/BS表示UI)で追加した。
 * expenseSplitting名前空間は計画Issue #40(割勘/精算UI)で追加した。
 * master名前空間は計画Issue #118で新設し、計画Issue #154でマスタ画面(勘定科目・取引先・世帯メンバー・
 * プロジェクト・定期取引の5タブ)の文言を1つの名前空間にまとめた。このとき、旧マスタ画面専用だった
 * account・accountGroup・counterparty・householdMember・project名前空間は未使用になったため削除した。
 * recurringTransaction名前空間は計画Issue #39で追加した。現在は提案レビュー画面と、繰り返しの表記
 * (describeRecurringSchedule)が使う(ルールの編集画面はmaster名前空間、計画Issue #154)。
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
      financialStatement,
      expenseSplitting,
      recurringTransaction,
    },
  },
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
