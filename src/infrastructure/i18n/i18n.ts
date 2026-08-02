import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../../locales/ja/common.json'

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
