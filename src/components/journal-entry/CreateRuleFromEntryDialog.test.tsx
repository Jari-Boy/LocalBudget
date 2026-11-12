// @vitest-environment jsdom
/**
 * 「定期仕訳にする」のダイアログ(CreateRuleFromEntryDialog、計画Issue #180)のコンポーネントテスト。
 * 仕訳の内容(行・摘要・起票者)がルールの編集画面に写されて開くこと、繰り返しの初期値(毎月・その仕訳の日付の日)と
 * 開始日(元の仕訳の翌日)、「登録」で作成の入力(元の仕訳の行そのまま)が渡ること、作成に失敗したら原因を
 * 表示すること、キャンセルで閉じることを検証する。外部依存なし(作成は props の関数)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import i18n from '../../infrastructure/i18n/i18n'
import { CreateRuleFromEntryDialog } from './CreateRuleFromEntryDialog'
import type { JournalEditorMaster } from './JournalEntryEditor'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category']): Account {
  return {
    id,
    category,
    name,
    isReconcilable: category === 'expense' ? null : false,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const master: JournalEditorMaster = {
  accounts: [account(10, '健康・運動', 'expense'), account(20, 'クレジットカード', 'liability')],
  accountCategories: [],
  counterpartyCategories: [],
  projectCategories: [],
  members: [{ id: 3, name: '夫', isGroup: false, isActive: true, createdAt: '', updatedAt: '' }],
  batches: [],
}

const entry: JournalEntry = {
  id: 1,
  entryDate: '2026-11-10',
  memo: 'ジム年会費',
  comment: null,
  currency: 'JPY',
  sourceType: 'manual',
  householdMemberId: 3,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [
    { id: 1, journalEntryId: 1, accountId: 10, projectId: null, householdMemberId: 3, counterpartyId: null, settlementBatchId: null, side: 'debit', amount: 9800, createdAt: '' },
    { id: 2, journalEntryId: 1, accountId: 20, projectId: null, householdMemberId: 3, counterpartyId: null, settlementBatchId: null, side: 'credit', amount: 9800, createdAt: '' },
  ],
}

function renderDialog(onCreate = vi.fn(async () => undefined), onCancel = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <CreateRuleFromEntryDialog entry={entry} master={master} today="2026-11-12" onCreate={onCreate} onCancel={onCancel} />
    </I18nextProvider>,
  )
  return { onCreate, onCancel }
}

describe('CreateRuleFromEntryDialog', () => {
  it('ダイアログに、定期仕訳タブと同じ編集画面が、仕訳の内容を写した初期値で開く', () => {
    renderDialog()

    const dialog = within(screen.getByRole('dialog', { name: '定期仕訳の作成' }))
    expect(dialog.getByLabelText('名称')).toHaveValue('ジム年会費')
    expect(dialog.getByLabelText('起票者')).toHaveValue('3')
    expect(within(dialog.getByRole('group', { name: '借方' })).getByLabelText('健康・運動の金額')).toHaveValue('9800')
    expect(within(dialog.getByRole('group', { name: '貸方' })).getByLabelText('クレジットカードの金額')).toHaveValue('9800')
  })

  it('繰り返しの初期値は「毎月、その仕訳の日付の日」、開始日は元の仕訳の翌日', () => {
    renderDialog()

    const dialog = within(screen.getByRole('dialog', { name: '定期仕訳の作成' }))
    expect(dialog.getByLabelText('繰り返し')).toHaveValue('monthly')
    expect(dialog.getByLabelText('日')).toHaveValue('10')
    expect(dialog.getByLabelText('開始日')).toHaveValue('2026-11-11')
  })

  it('「登録」を押すと、元の仕訳の行そのままのルールの入力で作成を呼ぶ', async () => {
    const { onCreate } = renderDialog()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    const input = (onCreate.mock.calls[0] as unknown[])[0] as {
      name: string
      bookkeeperHouseholdMemberId: number
      startsOn: string
      dayOfMonth: number
      lines: { side: string; accountId: number; amount: number }[]
    }
    expect(input).toMatchObject({ name: 'ジム年会費', bookkeeperHouseholdMemberId: 3, startsOn: '2026-11-11', dayOfMonth: 10 })
    expect(input.lines.map((l) => [l.side, l.accountId, l.amount])).toEqual([
      ['debit', 10, 9800],
      ['credit', 20, 9800],
    ])
  })

  it('作成に失敗したら、原因を添えてエラーを表示する', async () => {
    renderDialog(vi.fn(async () => Promise.reject(new Error('boom'))))

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('「キャンセル」で閉じる(作成は呼ばない)', () => {
    const { onCreate, onCancel } = renderDialog()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }))

    expect(onCancel).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
