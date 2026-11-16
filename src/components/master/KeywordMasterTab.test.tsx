// @vitest-environment jsdom
/**
 * KeywordMasterTab(マスタ画面の「キーワード」タブ、計画Issue #219)のコンポーネントテスト。
 * キーワードルール(取引先・相手科目とも任意)の一覧表示、列見出しの押下による昇順・降順の並び替え、
 * 追加・編集・削除、相手科目が資産・負債のときの取引先の無効化、不正な入力(空・重複・対象なし)の
 * 共通検証による拒否を、sql.jsのNode実装(createTestDatabase)で確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsKeywordRuleRepository } from '../../infrastructure/db/SqlJsKeywordRuleRepository'
import { KeywordMasterTab } from './KeywordMasterTab'

let db: Database
let rules: SqlJsKeywordRuleRepository
let cashId: number
let foodId: number
let aeonId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  rules = new SqlJsKeywordRuleRepository(db)
  const accounts = new SqlJsAccountRepository(db)
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  aeonId = new SqlJsCounterpartyRepository(db).create({ name: 'イオン', defaultAccountId: foodId }).id
})

afterEach(cleanup)

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <KeywordMasterTab
        keywordRuleRepository={rules}
        counterpartyRepository={new SqlJsCounterpartyRepository(db)}
        accountRepository={new SqlJsAccountRepository(db)}
      />
    </I18nextProvider>,
  )
}

/** 一覧のキーワードの行(世帯メンバー・取引先タブと同じツリー表。区分の見出し行・ヘッダー行は除く) */
const dataRows = () => screen.getAllByRole('row').filter((row) => within(row).queryByRole('checkbox') !== null && within(row).queryByRole('button') !== null)
const patternsInOrder = () => dataRows().map((row) => within(row).getAllByRole('button')[0].textContent)

describe('KeywordMasterTab', () => {
  it('登録済みのルールを、キーワード・取引先・相手科目の列で一覧し、既定はキーワードの昇順', async () => {
    rules.create({ pattern: 'VISA', accountId: cashId })
    rules.create({ pattern: 'AEON', counterpartyId: aeonId })
    renderTab()

    await screen.findByRole('table')

    expect(patternsInOrder()).toEqual(['AEON', 'VISA'])
    expect(within(dataRows()[0]).getByText('イオン')).toBeInTheDocument()
    expect(screen.getByText('すべてのキーワード')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /キーワード/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('科目の列にはルールに指定した科目名だけを出し、取引先だけのルールは空にする(「取引先の既定」は出さない)', async () => {
    rules.create({ pattern: 'AEON', counterpartyId: aeonId })
    rules.create({ pattern: 'ATM', accountId: cashId })
    renderTab()
    await screen.findByRole('table')

    expect(screen.queryByText(/取引先の既定/)).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '科目' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /相手科目/ })).not.toBeInTheDocument()
    expect(within(dataRows()[1]).getByText('現金')).toBeInTheDocument()
  })

  it('列見出しを押すと、その列で昇順と降順が入れ替わる', async () => {
    rules.create({ pattern: 'ATM', accountId: cashId })
    rules.create({ pattern: 'VISA', accountId: cashId })
    renderTab()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^キーワード/ }))

    expect(patternsInOrder()).toEqual(['VISA', 'ATM'])
    expect(screen.getByRole('columnheader', { name: /キーワード/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('キーワードと相手科目を入力して追加でき、全角は正規化して保存する', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '+ キーワードを追加' }))

    fireEvent.change(screen.getByLabelText(/^キーワード\(摘要/), { target: { value: 'ａｔｍ' } })
    fireEvent.change(screen.getByLabelText(/^相手科目/), { target: { value: String(cashId) } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(rules.findAll()).toHaveLength(1))
    expect(rules.findAll()[0]).toMatchObject({ pattern: 'ATM', accountId: cashId, counterpartyId: null })
  })

  it('相手科目に資産・負債の科目を選ぶと、取引先は選べなくなる', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '+ キーワードを追加' }))

    fireEvent.change(screen.getByLabelText(/^相手科目/), { target: { value: String(cashId) } })

    expect(screen.getByLabelText(/^取引先/)).toBeDisabled()
  })

  it('取引先も相手科目も指定しないと保存できず、理由を表示する', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '+ キーワードを追加' }))
    fireEvent.change(screen.getByLabelText(/^キーワード\(摘要/), { target: { value: 'XYZ' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取引先か相手科目のどちらかを指定してください')
    expect(rules.findAll()).toHaveLength(0)
  })

  it('空のキーワード、同じ対象の重複は、共通の検証で拒否される', async () => {
    rules.create({ pattern: 'ATM', accountId: cashId })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '+ キーワードを追加' }))
    fireEvent.change(screen.getByLabelText(/^相手科目/), { target: { value: String(cashId) } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('キーワードが空です')

    fireEvent.change(screen.getByLabelText(/^キーワード\(摘要/), { target: { value: 'atm' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('同じキーワードがすでにあります')
    expect(rules.findAll()).toHaveLength(1)
  })

  it('一覧の行を選んで編集・保存でき、削除もできる', async () => {
    const rule = rules.create({ pattern: 'ATM', accountId: cashId })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'ATM' }))

    fireEvent.change(screen.getByLabelText(/^キーワード\(摘要/), { target: { value: 'セブン銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(rules.findById(rule.id)?.pattern).toBe('セブン銀行'))

    fireEvent.click(await screen.findByRole('button', { name: 'セブン銀行' }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(rules.findAll()).toHaveLength(0))
  })

  it('検索欄に入れた文字列で、キーワード・取引先・科目のどれかに一致する行だけに絞り込む', async () => {
    rules.create({ pattern: 'ATM', accountId: cashId })
    rules.create({ pattern: 'AEON', counterpartyId: aeonId })
    renderTab()
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText('キーワードを検索'), { target: { value: 'イオン' } })

    expect(patternsInOrder()).toEqual(['AEON'])
  })

  it('行のチェックを入れると「選択した件数を削除」が出て、まとめて削除できる', async () => {
    rules.create({ pattern: 'ATM', accountId: cashId })
    rules.create({ pattern: 'VISA', accountId: cashId })
    rules.create({ pattern: 'AEON', counterpartyId: aeonId })
    renderTab()
    await screen.findByRole('table')

    fireEvent.click(screen.getByLabelText('ATMを選択'))
    fireEvent.click(screen.getByLabelText('VISAを選択'))
    fireEvent.click(screen.getByRole('button', { name: '選択した2件を削除' }))

    await waitFor(() => expect(rules.findAll().map((r) => r.pattern)).toEqual(['AEON']))
  })
})
