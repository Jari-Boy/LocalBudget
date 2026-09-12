import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'
import account from '../../locales/ja/account.json'
import accountGroup from '../../locales/ja/account-group.json'
import master from '../../locales/ja/master.json'
import journal from '../../locales/ja/journal.json'
import statementImport from '../../locales/ja/statementImport.json'
import counterparty from '../../locales/ja/counterparty.json'
import householdMember from '../../locales/ja/household-member.json'
import project from '../../locales/ja/project.json'
import financialStatement from '../../locales/ja/financial-statement.json'
import expenseSplitting from '../../locales/ja/expenseSplitting.json'

/**
 * ドメイン別の名前空間(account.json等)は、それぞれのUI実装Issue(D1〜D10、
 * #31〜#40)側が着手時に`resources.ja`へ追加する方針(計画Issue #29)。
 * account名前空間は計画Issue #31(口座/クレジットカード登録UI)で追加した。
 * journal名前空間は計画Issue #32(マニュアル仕訳入力UI)で追加した。
 * statementImport名前空間は計画Issue #76(CSV取込〜レビュー一覧の基盤)で追加した。
 * counterparty名前空間は計画Issue #38(取引先管理UI)で追加した。
 * householdMember名前空間は計画Issue #37(世帯メンバー管理UI)で追加した。
 * project名前空間は計画Issue #36(プロジェクト管理UI)で追加した。
 * financialStatement名前空間は計画Issue #34(財務諸表PL/BS表示UI)で追加した。
 * expenseSplitting名前空間は計画Issue #40(割勘/精算UI)で追加した。
 * accountGroup名前空間は計画Issue #112(勘定科目グループのCRUD・科目への割り当てUI)で追加した。
 * master名前空間は計画Issue #118(react-routerベースのナビゲーション基盤刷新)で、
 * マスタ管理ハブ画面(/master)がaccount/counterparty/householdMember/project等
 * 複数ドメインの名前空間をまたいで再利用するため新設した。
 */
void i18n.use(initReactI18next).init({
  lng: 'ja',
  fallbackLng: 'ja',
  defaultNS: 'common',
  resources: {
    ja: {
      common,
      account,
      accountGroup,
      master,
      journal,
      statementImport,
      counterparty,
      householdMember,
      project,
      financialStatement,
      expenseSplitting,
    },
  },
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
