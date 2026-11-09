// @vitest-environment jsdom
/**
 * 割勘・精算画面(SplitSettleScreen、計画Issue #153)のコンポーネントテスト。
 * 「割勘」「精算」の2タブが画面遷移なしで切り替わること、開くタブを指定できること、読み込み中の表示、
 * 書き込みのあとにデータを読み直すことを、インメモリの偽Repository(vi.fn)で検証する。
 * 各タブの中身は SplitTab・SettleTab のテストで検証する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { SplitSettleScreen } from './SplitSettleScreen'
import type { SplitSettleRepositories } from './splitSettleData'

afterEach(cleanup)

function makeRepositories() {
  const accounts = [
    { id: 1, name: '食費', category: 'expense', isActive: true, isSystemManaged: false, accountGroupId: null, sortOrder: 1 },
    { id: 2, name: '普通預金', category: 'asset', isActive: true, isSystemManaged: false, accountGroupId: null, sortOrder: 2 },
    { id: 3, name: '立替金', category: 'asset', isActive: true, isSystemManaged: true, accountGroupId: null, sortOrder: 3 },
    { id: 4, name: '未払金', category: 'liability', isActive: true, isSystemManaged: true, accountGroupId: null, sortOrder: 4 },
  ]
  const entry = {
    id: 1,
    entryDate: '2026-10-05',
    memo: 'ランチ',
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines: [
      { id: 11, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'debit', amount: 1200, createdAt: '' },
      { id: 12, journalEntryId: 1, accountId: 2, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'credit', amount: 1200, createdAt: '' },
    ],
  } as JournalEntry
  const repositories = {
    journalEntryRepository: {
      findAll: vi.fn(async () => [entry]),
      create: vi.fn(async () => ({ id: 500 }) as JournalEntry),
      update: vi.fn(),
      delete: vi.fn(),
    },
    journalEntryLinkGroupRepository: { findAllMemberships: vi.fn(async () => []), joinOrCreateGroups: vi.fn(async () => {}) },
    accountRepository: { findAll: vi.fn(async () => accounts) },
    accountGroupRepository: { findAll: vi.fn(async () => []) },
    counterpartyRepository: { findAll: vi.fn(async () => []), create: vi.fn() },
    counterpartyGroupRepository: { findAll: vi.fn(async () => []) },
    projectRepository: { findAll: vi.fn(async () => []) },
    projectGroupRepository: { findAll: vi.fn(async () => []) },
    householdMemberRepository: {
      findAll: vi.fn(async () => [
        { id: 1, name: '夫' },
        { id: 2, name: '妻' },
      ]),
    },
    settlementBatchRepository: {
      findAll: vi.fn(async () => []),
      create: vi.fn(async (input: { name: string }) => ({ id: 77, name: input.name })),
      update: vi.fn(),
    },
  }
  return repositories
}

function renderScreen(props: { initialTab?: 'split' | 'settle' } = {}) {
  const repositories = makeRepositories()
  render(
    <SplitSettleScreen
      repositories={repositories as unknown as SplitSettleRepositories}
      today="2026-10-31"
      {...props}
    />,
  )
  return { repositories }
}

describe('SplitSettleScreen', () => {
  it('読み込みが終わるまで読み込み中を表示し、終わると割勘タブを出す', async () => {
    renderScreen()

    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    expect(await screen.findByRole('heading', { name: '割勘・精算' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '割勘' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: '割勘する仕訳' })).toBeInTheDocument()
  })

  it('「精算」タブに切り替えると精算バッチの一覧を出し、画面遷移はしない', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '割勘・精算' })

    fireEvent.click(screen.getByRole('tab', { name: '精算' }))

    expect(screen.getByRole('tab', { name: '精算' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: '割勘する仕訳' })).not.toBeInTheDocument()
    expect(screen.getByText('精算バッチはまだありません。割勘を記録すると作られます。')).toBeInTheDocument()
  })

  it('initialTab に settle を渡すと、最初から精算タブを開く', async () => {
    renderScreen({ initialTab: 'settle' })

    expect(await screen.findByRole('tab', { name: '精算' })).toHaveAttribute('aria-selected', 'true')
  })

  it('割勘を記録したあとは、データを読み直して最新の状態にする', async () => {
    const { repositories } = renderScreen()
    await screen.findByRole('heading', { name: '割勘・精算' })
    expect(repositories.journalEntryRepository.findAll).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    fireEvent.click(screen.getByRole('button', { name: /^分担相手/ }))
    fireEvent.click(screen.getByRole('button', { name: '妻' }))
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() => expect(repositories.journalEntryRepository.findAll).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('割勘を記録しました')).toBeInTheDocument()
  })
})
