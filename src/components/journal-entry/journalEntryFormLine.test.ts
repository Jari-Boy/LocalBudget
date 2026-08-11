/**
 * 仕訳入力フォームの1行分の入力状態(JournalEntryFormLine)を扱う純粋関数群
 * (計画Issue #32)のユニットテスト。フォーム行↔下書き行(JournalEntryDraftLineInput)・
 * 確定送信用の行(JournalLineInput)相互の変換と、取引先入力欄をPL科目行にのみ
 * 表示するための科目区分判定を検証する。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntryDraftLine } from '../../domain/journal/JournalEntryDraft'
import {
  createEmptyJournalEntryFormLine,
  fromJournalEntryDraftLine,
  isCounterpartyEligibleCategory,
  isManualEntryEligibleAccount,
  toJournalEntryDraftLineInput,
  toJournalLineInput,
} from './journalEntryFormLine'

describe('createEmptyJournalEntryFormLine', () => {
  it('全項目が未選択・空文字の初期状態を返す', () => {
    expect(createEmptyJournalEntryFormLine()).toEqual({
      accountId: null,
      side: null,
      amountInput: '',
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
    })
  })
})

describe('isCounterpartyEligibleCategory', () => {
  it('収益(revenue)・費用(expense)区分はtrueを返す', () => {
    expect(isCounterpartyEligibleCategory('revenue')).toBe(true)
    expect(isCounterpartyEligibleCategory('expense')).toBe(true)
  })

  it('資産・負債・純資産区分はfalseを返す', () => {
    expect(isCounterpartyEligibleCategory('asset')).toBe(false)
    expect(isCounterpartyEligibleCategory('liability')).toBe(false)
    expect(isCounterpartyEligibleCategory('equity')).toBe(false)
  })
})

describe('isManualEntryEligibleAccount', () => {
  it('isReconcilable = trueの科目はfalseを返す(マニュアル仕訳では直接記帳できないため選択肢から除外する)', () => {
    expect(isManualEntryEligibleAccount({ isReconcilable: true })).toBe(false)
  })

  it('isReconcilable = falseの科目はtrueを返す', () => {
    expect(isManualEntryEligibleAccount({ isReconcilable: false })).toBe(true)
  })

  it('isReconcilable = null(PL科目・純資産科目等)の科目はtrueを返す', () => {
    expect(isManualEntryEligibleAccount({ isReconcilable: null })).toBe(true)
  })
})

describe('toJournalEntryDraftLineInput', () => {
  it('全項目入力済みの行を下書き行入力に変換する(金額は数値化)', () => {
    const line = {
      accountId: 1,
      side: 'debit' as const,
      amountInput: '3000',
      projectId: 2,
      householdMemberId: 3,
      counterpartyId: 4,
    }
    expect(toJournalEntryDraftLineInput(line)).toEqual({
      accountId: 1,
      side: 'debit',
      amount: 3000,
      projectId: 2,
      householdMemberId: 3,
      counterpartyId: 4,
    })
  })

  it('金額が未入力(空文字)または数値に変換できない場合、amountはnullになる', () => {
    const base = {
      accountId: null,
      side: null,
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
    }
    expect(toJournalEntryDraftLineInput({ ...base, amountInput: '' }).amount).toBeNull()
    expect(toJournalEntryDraftLineInput({ ...base, amountInput: 'abc' }).amount).toBeNull()
  })
})

describe('toJournalLineInput', () => {
  it('科目・貸借・正の金額が揃っている行はJournalLineInputに変換される', () => {
    const line = {
      accountId: 1,
      side: 'credit' as const,
      amountInput: '5000',
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
    }
    expect(toJournalLineInput(line)).toEqual({
      accountId: 1,
      side: 'credit',
      amount: 5000,
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
    })
  })

  it('科目が未選択の行はnullを返す(確定送信の対象から除外する)', () => {
    expect(
      toJournalLineInput({
        accountId: null,
        side: 'debit',
        amountInput: '1000',
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
      }),
    ).toBeNull()
  })

  it('貸借が未選択の行はnullを返す', () => {
    expect(
      toJournalLineInput({
        accountId: 1,
        side: null,
        amountInput: '1000',
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
      }),
    ).toBeNull()
  })

  it('金額が未入力・0以下・数値に変換できない行はnullを返す', () => {
    const base = { accountId: 1, side: 'debit' as const, projectId: null, householdMemberId: null, counterpartyId: null }
    expect(toJournalLineInput({ ...base, amountInput: '' })).toBeNull()
    expect(toJournalLineInput({ ...base, amountInput: '0' })).toBeNull()
    expect(toJournalLineInput({ ...base, amountInput: '-100' })).toBeNull()
    expect(toJournalLineInput({ ...base, amountInput: 'abc' })).toBeNull()
  })
})

describe('fromJournalEntryDraftLine', () => {
  it('下書き行をフォーム行に変換する(金額は文字列化、未入力はnullのまま)', () => {
    const draftLine: JournalEntryDraftLine = {
      id: 10,
      journalEntryDraftId: 1,
      accountId: 1,
      projectId: 2,
      householdMemberId: 3,
      counterpartyId: 4,
      side: 'debit',
      amount: 7000,
      createdAt: '2026-08-11T00:00:00.000Z',
    }
    expect(fromJournalEntryDraftLine(draftLine)).toEqual({
      accountId: 1,
      side: 'debit',
      amountInput: '7000',
      projectId: 2,
      householdMemberId: 3,
      counterpartyId: 4,
    })
  })

  it('未入力項目(null)が含まれる下書き行を変換すると、金額はnullではなく空文字になる', () => {
    const draftLine: JournalEntryDraftLine = {
      id: 11,
      journalEntryDraftId: 1,
      accountId: null,
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
      side: null,
      amount: null,
      createdAt: '2026-08-11T00:00:00.000Z',
    }
    expect(fromJournalEntryDraftLine(draftLine)).toEqual({
      accountId: null,
      side: null,
      amountInput: '',
      projectId: null,
      householdMemberId: null,
      counterpartyId: null,
    })
  })
})
