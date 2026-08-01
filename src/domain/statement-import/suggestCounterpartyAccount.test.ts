/**
 * suggestCounterpartyAccount(相手勘定科目サジェスト、docs/domain/statement-import.md 1.5 手順5-b・
 * 1.7スコープ)の純粋関数寄りのユニットテスト。MVPスコープは取引先経由のサジェストのみ
 * (counterparties.default_account_id)であり、未消込の未払金・未収金消込サジェスト(手順5-a)は
 * 対象外(settlement.mdドメイン、別Issue)。DBには依存せず、findByIdをスタブ化したフェイク
 * リポジトリで検証する。
 */
import { describe, expect, it } from 'vitest'
import type { Counterparty } from '../counterparty/Counterparty'
import { suggestCounterpartyAccount } from './suggestCounterpartyAccount'

function fakeRepository(counterparties: Counterparty[]) {
  return {
    findById(id: number): Counterparty | null {
      return counterparties.find((c) => c.id === id) ?? null
    },
  }
}

describe('suggestCounterpartyAccount', () => {
  it('取引先にdefaultAccountIdが設定されていればそれをサジェストする', () => {
    const repo = fakeRepository([
      {
        id: 10,
        name: 'Amazon',
        defaultAccountId: 5,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])

    expect(suggestCounterpartyAccount(10, repo)).toBe(5)
  })

  it('取引先にdefaultAccountIdが未設定(null)ならnullを返す', () => {
    const repo = fakeRepository([
      {
        id: 10,
        name: 'Amazon',
        defaultAccountId: null,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])

    expect(suggestCounterpartyAccount(10, repo)).toBeNull()
  })

  it('counterpartyIdがnull(取引先が特定できていない)の場合はnullを返す', () => {
    const repo = fakeRepository([])

    expect(suggestCounterpartyAccount(null, repo)).toBeNull()
  })

  it('該当する取引先が存在しない場合もnullを返す', () => {
    const repo = fakeRepository([])

    expect(suggestCounterpartyAccount(999, repo)).toBeNull()
  })
})
