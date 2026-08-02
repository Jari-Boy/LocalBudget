import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'

/**
 * リソースファイルはlocales/ja/common.jsonのみを本Issue(#29)で先行用意する。
 * ドメイン別の名前空間(account.json等)は、それぞれのUI実装Issue(D1〜D10、
 * #31〜#40)側が着手時に`resources.ja`へ追加する方針とし、使われない名前空間を
 * 本Issueで先回りして作らない。
 */
void i18n.use(initReactI18next).init({
  lng: 'ja',
  fallbackLng: 'ja',
  defaultNS: 'common',
  resources: {
    ja: { common },
  },
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
