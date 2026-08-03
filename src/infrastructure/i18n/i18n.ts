import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'
import account from '../../locales/ja/account.json'

/**
 * ドメイン別の名前空間(account.json等)は、それぞれのUI実装Issue(D1〜D10、
 * #31〜#40)側が着手時に`resources.ja`へ追加する方針(計画Issue #29)。
 * account名前空間は計画Issue #31(口座/クレジットカード登録UI)で追加した。
 */
void i18n.use(initReactI18next).init({
  lng: 'ja',
  fallbackLng: 'ja',
  defaultNS: 'common',
  resources: {
    ja: { common, account },
  },
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
