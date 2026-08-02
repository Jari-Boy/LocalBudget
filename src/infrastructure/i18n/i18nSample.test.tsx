// @vitest-environment jsdom
/**
 * react-i18next経由でリソースファイル(src/locales/ja/common.json)の文字列を
 * 画面に表示できることを確認するテスト。i18n基盤導入(計画Issue #29)の完了条件を
 * 満たすためのサンプルコンポーネントはこのテストファイル内にのみ定義し、
 * プロダクションコード(App.tsx等)には追加しない。DOM描画を伴うため
 * ファイル単位でjsdom環境を有効化する(既存のvitest.config.tsのenvironment: 'node'は
 * sql.js関連の既存テストに影響しないよう変更しない)。
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { I18nextProvider, useTranslation } from 'react-i18next'
import i18n from './i18n'

function SampleGreeting() {
  const { t } = useTranslation()
  return <p>{t('appName')}</p>
}

describe('i18nを用いたコンポーネントの表示', () => {
  test('common名前空間のリソース文字列が画面に表示される', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SampleGreeting />
      </I18nextProvider>,
    )

    expect(screen.getByText(i18n.t('appName'))).toBeInTheDocument()
  })
})
