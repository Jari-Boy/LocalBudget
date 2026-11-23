// @vitest-environment jsdom
/**
 * 割勘タブ(SplitTab、計画Issue #153。計画Issue #271で明細行単位にした)のコンポーネントテスト。承認済みモックアップの構成で、
 * 絞り込み・割勘する行の表(借方を左・貸方を右)・分担(相手と割合)・割勘仕訳のプレビューが縦に並ぶことを検証する。
 * 費用・収益の行(借方・貸方とも)だけ選べて、それ以外の行はチェックできないこと、割勘済みの行は表示しないこと、
 * 選んだ行の合計(借方と貸方は差し引き)と相手の負担額が出ること、「割勘を記録」で仕訳が作られて画面が更新されること、
 * 相手を選ばないと記録できないことを、インメモリの偽Repository(vi.fn)で検証する。
 * 割勘履歴は履歴タブ(SplitHistoryTab、計画Issue #268)にあり、そのテストは SplitHistoryTab.test.tsx にある。
 * 候補は仕訳150件ずつ「さらにN件表示」で出し、チェック済みの行が150件の外にあるときは選択行まで広げる(計画Issue #268)。
 */
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { chooseBatchFrom } from '../master/batchSelectTestHelpers'
import { SplitTab } from './SplitTab'
import { deriveSplitSettle, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
  }
}

const accounts = [
  account(1, '食費', 'expense'),
  account(2, '普通預金', 'asset'),
  account(3, '立替金', 'asset', true),
  account(4, '未払金', 'liability', true),
  account(5, '給与', 'revenue'),
  account(6, '現金', 'asset'),
]

function line(
  id: number,
  entryId: number,
  side: 'debit' | 'credit',
  accountId: number,
  amount: number,
  overrides: Partial<JournalLine> = {},
): JournalLine {
  return {
    id,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
    ...overrides,
  }
}

function entry(id: number, date: string, memo: string, sourceType: JournalEntry['sourceType'], lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: date,
    memo,
    comment: null,
    currency: 'JPY',
    sourceType,
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

function makeData(extraEntries: JournalEntry[] = []): SplitSettleData {
  return {
    entries: [
      entry(1, '2026-10-05', 'ランチ', 'manual', [line(11, 1, 'debit', 1, 1200), line(12, 1, 'credit', 2, 1200)]),
      entry(2, '2026-10-03', '10月の振替', 'manual', [line(21, 2, 'debit', 2, 300000), line(22, 2, 'credit', 6, 300000)]),
      ...extraEntries,
    ],
    accounts,
    accountGroups: [],
    counterparties: [{ id: 9, name: '友人A', isActive: true } as never],
    counterpartyGroups: [],
    projects: [],
    projectGroups: [],
    members: [
      { id: 1, name: '夫' },
      { id: 2, name: '妻' },
    ] as never,
    batches: [],
    memberships: [],
    sourceLinks: [],
  }
}

function setup(data: SplitSettleData = makeData(), extraProps: { initialCheckedEntryIds?: readonly number[] } = {}) {
  const repositories = {
    journalEntryRepository: {
      create: vi.fn(async () => ({ id: 500 }) as JournalEntry),
      delete: vi.fn(async () => {}),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
    settlementBatchRepository: {
      create: vi.fn(async (input: { name: string }) => ({ id: 77, name: input.name })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => {}),
    },
    counterpartyRepository: { create: vi.fn(async () => ({ id: 20, name: '新しい人' })) },
  }
  const onChanged = vi.fn(async () => {})
  render(
    <SplitTab
      data={data}
      derived={deriveSplitSettle(data)}
      repositories={repositories as unknown as SplitSettleRepositories}
      today="2026-10-31"
      onChanged={onChanged}
      filter={{}}
      onFilterChange={() => {}}
      filterOpen={false}
      {...extraProps}
    />,
  )
  return { repositories, onChanged }
}

const chooseOption = (triggerName: RegExp, optionName: string, index = 0) => {
  fireEvent.click(screen.getAllByRole('button', { name: triggerName })[index])
  fireEvent.click(within(screen.getByRole('dialog', { name: /分担相手/ })).getByRole('button', { name: optionName }))
}

/** 負担する人を、1行目に妻・2行目に夫(立て替えた本人)として選ぶ(割合は初期値の50%ずつで、合計100%) */
const chooseBothPartners = () => {
  chooseOption(/^分担相手/, '妻', 0)
  chooseOption(/^分担相手/, '夫', 1)
}

const splitEntry = () =>
  entry(3, '2026-10-30', 'ランチの割勘', 'expense_splitting', [
    line(31, 3, 'debit', 1, 600, { householdMemberId: 2 }),
    line(32, 3, 'debit', 3, 600, { householdMemberId: 1, settlementBatchId: 7 }),
    line(33, 3, 'credit', 1, 600, { householdMemberId: 1 }),
    line(34, 3, 'credit', 4, 600, { householdMemberId: 2, settlementBatchId: 7 }),
  ])

/** 摘要の行(仕訳の先頭の行)の、借方・貸方側のチェックボックス */
const rowOf = (memo: string) => screen.getByRole('button', { name: memo }).closest('tr') as HTMLElement
const debitBox = (memo: string) => within(rowOf(memo)).getByRole('checkbox', { name: /^借方の.*の行を選択$/ }) as HTMLInputElement
const creditBox = (memo: string) => within(rowOf(memo)).getByRole('checkbox', { name: /^貸方の.*の行を選択$/ }) as HTMLInputElement

/** 返品(貸方の費用の行): 食費 200 を貸方に持つ */
const refundEntry = () =>
  entry(4, '2026-10-04', '返品', 'manual', [line(41, 4, 'debit', 2, 200), line(42, 4, 'credit', 1, 200)])

describe('SplitTab', () => {
  it('これまでの割勘(履歴)は割勘タブには出さない(履歴タブに移した、計画Issue #268)', () => {
    const data = makeData([splitEntry()])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 1, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never
    setup(data)

    expect(screen.queryByRole('region', { name: '割勘履歴' })).not.toBeInTheDocument()
    expect(screen.queryByText('過去の割勘')).not.toBeInTheDocument()
    expect(screen.queryByText('ランチの割勘')).not.toBeInTheDocument()
  })

  it('費用・収益の行がある仕訳だけを候補の表に出し、費用・収益でない行はチェックできない', () => {
    setup()

    const table = screen.getByRole('region', { name: '割勘する行' })
    expect(within(table).getByText('ランチ')).toBeInTheDocument()
    expect(within(table).queryByText('10月の振替')).not.toBeInTheDocument()
    expect(debitBox('ランチ')).toBeEnabled()
    expect(creditBox('ランチ')).toBeDisabled()
    expect(creditBox('ランチ')).toHaveAttribute('title', '費用・収益の行ではないため選べません')
  })

  it('収益の行(貸方)も選べる行として出す', () => {
    setup(makeData([entry(7, '2026-10-06', 'ポイント還元', 'manual', [line(71, 7, 'debit', 2, 500), line(72, 7, 'credit', 5, 500)])]))

    expect(creditBox('ポイント還元')).toBeEnabled()
    expect(debitBox('ポイント還元')).toBeDisabled()
  })

  it('割勘済みの行(割勘対象行の記録がある行)は表示せず、すべて割勘済みの仕訳は候補から消える', () => {
    const data = makeData([splitEntry()])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 1, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never
    data.sourceLinks = [{ splitEntryId: 3, sourceLineId: 11 }]
    setup(data)

    expect(screen.queryByRole('button', { name: 'ランチ' })).not.toBeInTheDocument()
  })

  it('同じ仕訳の一部の行だけが割勘済みなら、残りの行は選べる', () => {
    const multi = entry(8, '2026-10-07', 'まとめ買い', 'manual', [
      line(81, 8, 'debit', 1, 700),
      line(82, 8, 'debit', 1, 300),
      line(83, 8, 'credit', 2, 1000),
    ])
    const data = makeData([multi, splitEntry()])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 8, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never
    data.sourceLinks = [{ splitEntryId: 3, sourceLineId: 81 }]
    setup(data)

    const row = within(rowOf('まとめ買い'))
    expect(row.getByText(formatCurrency(300, 'JPY'))).toBeInTheDocument()
    expect(row.queryByText(formatCurrency(700, 'JPY'))).not.toBeInTheDocument()
  })

  it('仕訳のコメントを、摘要の右のコメントの列に出す(仕訳の先頭の行だけ)', () => {
    const data = makeData()
    data.entries = data.entries.map((e) => (e.id === 1 ? { ...e, comment: '割り勘にしたい分' } : e))
    setup(data)

    expect(screen.getByRole('columnheader', { name: /^コメント/ })).toBeInTheDocument()
    expect(within(rowOf('ランチ')).getByText('割り勘にしたい分')).toBeInTheDocument()
  })

  it('候補の摘要を押すと、仕訳画面へ移動せず、その仕訳の詳細をダイアログで表示し、選択状態は変えない', () => {
    setup()

    fireEvent.click(within(screen.getByRole('region', { name: '割勘する行' })).getByRole('button', { name: 'ランチ' }))

    const dialog = screen.getByRole('dialog', { name: '仕訳の詳細' })
    expect(dialog).toHaveTextContent('2026-10-05')
    expect(within(dialog).getByRole('region', { name: '借方' })).toHaveTextContent('食費')
    expect(debitBox('ランチ')).not.toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: '仕訳の詳細' })).not.toBeInTheDocument()
  })

  it('行を選ぶと、選んだ合計を表示する(分担の右下に、負担の合計は二重に出さない)', () => {
    setup()

    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()

    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1200, 'JPY'))
    expect(within(panel).queryByText('負担額の合計')).not.toBeInTheDocument()
    expect(within(panel).queryByText('負担割合の合計')).not.toBeInTheDocument()
  })

  it('借方の行と貸方の行(返金)を一緒に選ぶと、貸方を差し引いた額を合計にして按分する', () => {
    setup(makeData([refundEntry()]))

    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(creditBox('返品'))
    chooseBothPartners()

    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1000, 'JPY'))
    expect(within(panel).getByText('貸方の合計(差し引き)').nextElementSibling).toHaveTextContent(formatCurrency(-200, 'JPY'))
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1000, 'JPY'))
  })

  it('選んだ行から作られる割勘仕訳のプレビューを、分担を選んだあとに表示する', () => {
    setup(makeData([refundEntry()]))

    expect(screen.queryByRole('region', { name: '割勘仕訳のプレビュー' })).not.toBeInTheDocument()
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(creditBox('返品'))
    chooseBothPartners()

    const preview = screen.getByRole('region', { name: '割勘仕訳のプレビュー' })
    expect(within(preview).getByRole('table', { name: '妻さん分の割勘仕訳' })).toBeInTheDocument()
    expect(within(preview).queryByText('元の行')).not.toBeInTheDocument()
    // 借方600−貸方100の差し引き500が立替金・未払金になる(借方・貸方の合計は一致)
    expect(within(preview).getAllByText(formatCurrency(500, 'JPY')).length).toBeGreaterThan(0)
  })

  it('立て替えた本人も、負担する人の1行として選べる(誰がどのくらい負担するかを全員分入れる)', () => {
    setup()

    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(screen.getAllByRole('button', { name: /^分担相手/ })[0])

    const dialog = within(screen.getByRole('dialog', { name: /分担相手/ }))
    expect(dialog.getByRole('button', { name: '夫' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '妻' })).toBeInTheDocument()
  })

  it('負担する人の欄は、最初から2行(割合は50%ずつ)ある', () => {
    setup()

    expect(screen.getAllByRole('button', { name: /^分担相手/ })).toHaveLength(2)
    expect(screen.getAllByLabelText(/の負担割合/).map((e) => (e as HTMLInputElement).value)).toEqual(['50', '50'])
  })

  it('1行目の負担する人は、選んだ行の立替者のうち、最も行数の多い世帯メンバーが自動で入る(行を選ぶまでは未選択)', () => {
    const wifePaid = (id: number, memo: string) => ({
      ...entry(id, '2026-10-04', memo, 'manual', [line(id * 10 + 1, id, 'debit', 1, 400), line(id * 10 + 2, id, 'credit', 2, 400)]),
      householdMemberId: 2,
    })
    setup(makeData([wifePaid(5, 'コーヒー'), wifePaid(6, '映画')]))
    const triggers = () => screen.getAllByRole('button', { name: /^分担相手/ })

    expect(triggers().map((t) => t.getAttribute('aria-label'))).toEqual(['分担相手: 相手を選ぶ', '分担相手: 相手を選ぶ'])
    // 夫の行1つ(ランチ)と、妻の行2つ(コーヒー・映画)を選ぶと、行数の多い妻が1行目に入る。2行目は未選択のまま
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(debitBox('コーヒー'))
    fireEvent.click(debitBox('映画'))

    expect(triggers()[0]).toHaveAccessibleName('分担相手: 妻')
    expect(triggers()[1]).toHaveAccessibleName('分担相手: 相手を選ぶ')
  })

  it('1行目を自分で選び直したら、行の選択を変えても自動では上書きしない', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    expect(screen.getAllByRole('button', { name: /^分担相手/ })[0]).toHaveAccessibleName('分担相手: 夫')

    chooseOption(/^分担相手/, '妻', 0)
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(debitBox('ランチ'))

    expect(screen.getAllByRole('button', { name: /^分担相手/ })[0]).toHaveAccessibleName('分担相手: 妻')
  })

  it('負担する人の見出しや注記に「立て替えた本人も入れる」の説明は出さない', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('妻の負担割合(%)'), { target: { value: '40' } })

    expect(screen.queryByText(/立て替えた本人/)).not.toBeInTheDocument()
  })

  it('割合の合計が100%でないときは、合計と足りない旨を出し、「割勘を記録」を押せない。100%に直すと押せる', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()

    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('妻の負担割合(%)'), { target: { value: '40' } })

    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeDisabled()
    expect(screen.queryByText('負担割合の合計')).not.toBeInTheDocument()
    expect(screen.getByText(/合計を100%にしてください/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('妻の負担割合(%)'), { target: { value: '50' } })
    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeEnabled()
  })

  it('他の行で選んだ人は、この行の分担相手の選択肢に出ない(同じ人を二重に選べない)。自分の行の選択は出る', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseOption(/^分担相手/, '妻', 0)

    fireEvent.click(screen.getAllByRole('button', { name: /^分担相手/ })[1])
    const second = within(screen.getByRole('dialog', { name: /分担相手/ }))
    expect(second.queryByRole('button', { name: '妻' })).not.toBeInTheDocument()
    expect(second.getByRole('button', { name: '夫' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('負担する人の行数に応じて、割合は均等になる初期値が入る(2行は50%ずつ、3行は34・33・33%、1行は100%)。行を増減すると入れ直す', () => {
    setup()
    const ratios = () => screen.getAllByLabelText(/の負担割合/).map((e) => (e as HTMLInputElement).value)

    expect(ratios()).toEqual(['50', '50'])
    fireEvent.click(screen.getByRole('button', { name: '+ 分担相手を追加' }))
    expect(ratios()).toEqual(['34', '33', '33'])
    fireEvent.click(screen.getAllByRole('button', { name: /を分担相手から外す/ })[2])
    fireEvent.click(screen.getAllByRole('button', { name: /を分担相手から外す/ })[1])
    expect(ratios()).toEqual(['100'])
  })

  it('割合を自分で直したあとは、他の行の割合を自動で変えない。行を増減すると、また均等に入れ直す', () => {
    setup()
    const ratios = () => screen.getAllByLabelText(/の負担割合/).map((e) => (e as HTMLInputElement).value)
    fireEvent.change(screen.getAllByLabelText(/の負担割合/)[0], { target: { value: '70' } })

    expect(ratios()).toEqual(['70', '50'])
    fireEvent.click(screen.getByRole('button', { name: '+ 分担相手を追加' }))
    expect(ratios()).toEqual(['34', '33', '33'])
  })

  it('金額指定に切り替えると、選んだ行の合計を人数で均等に分けた金額が初期値で入る(端数は先の行へ)', () => {
    setup(makeData([refundEntry()]))
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(creditBox('返品'))
    fireEvent.change(screen.getByLabelText('按分の方法'), { target: { value: 'amount' } })
    const amounts = () => screen.getAllByLabelText(/の負担額を入力/).map((e) => (e as HTMLInputElement).value)

    expect(amounts()).toEqual(['500', '500'])
    fireEvent.click(debitBox('ランチ'))
    // 返品(貸方200)だけの選択になると、差し引きの200を均等に分けた100ずつになる
    expect(amounts()).toEqual(['100', '100'])
  })

  it('金額指定では、負担額の合計が選んだ行の合計に合うまで「割勘を記録」を押せない', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('按分の方法'), { target: { value: 'amount' } })

    fireEvent.change(screen.getByLabelText('妻の負担額を入力'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('夫の負担額を入力'), { target: { value: '600' } })
    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeDisabled()
    expect(screen.getByText(/合計を1,200円にしてください|合計を.*1,200.*にしてください/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('夫の負担額を入力'), { target: { value: '700' } })
    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeEnabled()
  })

  it('各人の負担額を、その人の行の右に出す(立て替えた本人の分も)', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()

    const wife = screen.getByLabelText('妻の負担割合(%)').closest('.split-settle__partner') as HTMLElement
    const husband = screen.getByLabelText('夫の負担割合(%)').closest('.split-settle__partner') as HTMLElement
    expect(within(wife).getByText(formatCurrency(600, 'JPY'))).toBeInTheDocument()
    expect(within(husband).getByText(formatCurrency(600, 'JPY'))).toBeInTheDocument()
  })

  it('選んだ行の数と合計は、ラベルを左・値を右にそろえた行で表示する', () => {
    setup()

    fireEvent.click(debitBox('ランチ'))

    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選んだ行').nextElementSibling).toHaveTextContent('1行')
    expect(within(panel).getByText('選択した合計').parentElement).toHaveClass('split-settle__line')
    expect(within(panel).getByText('選択した合計').closest('.split-settle__totals')).not.toBeNull()
  })

  it('「割勘を記録」で選んだ行だけの割勘仕訳を作り、元の仕訳と同じ関連仕訳グループへ合流して画面を更新する', async () => {
    const { repositories, onChanged } = setup()

    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチの割勘' } })
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(repositories.settlementBatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ランチの割勘' }),
    )
    expect(repositories.journalEntryRepository.create).toHaveBeenCalledTimes(1)
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ expenseSplitSourceLineIds: number[] }][])[0][0]
    expect(created.expenseSplitSourceLineIds).toEqual([11])
    expect(repositories.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1], [500])
    expect(screen.getByText('割勘を記録しました')).toBeInTheDocument()
  })

  it('摘要を入力して割勘すると、その摘要が割勘仕訳の摘要と、新しく作る精算バッチの名前になる', async () => {
    const { repositories } = setup()

    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '10月の外食まとめ' } })
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() =>
      expect(repositories.settlementBatchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '10月の外食まとめ' }),
      ),
    )
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ memo: string }][])[0][0]
    expect(created.memo).toBe('10月の外食まとめ')
  })

  it('摘要は必須。空のまま記録しようとすると、何も作らずエラーを表示する', async () => {
    const { repositories } = setup()

    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('摘要を入力してください')
    expect(screen.getByLabelText('摘要')).toBeRequired()
    expect(repositories.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repositories.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('摘要の入力欄には、入力の例として既定の摘要(元の摘要+の割勘)を見せるだけで、空のままでは使わない', () => {
    setup()

    fireEvent.click(debitBox('ランチ'))

    expect(screen.getByLabelText('摘要')).toHaveAttribute('placeholder', 'ランチの割勘')
  })

  it('複数の仕訳の行を選んだときは、摘要の入力例は出さない(空のまま入力させる)', () => {
    setup(makeData([refundEntry()]))

    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(creditBox('返品'))

    expect(screen.getByLabelText('摘要')).toHaveAttribute('placeholder', '')
  })

  it('精算バッチは、既定で「新しいバッチを作成」が選ばれ、既存のバッチも候補に出て、選び直して戻せる', () => {
    const data = makeData()
    data.batches = [{ id: 7, name: '9月の精算', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]
    setup(data)

    const batchButton = () => screen.getByRole('button', { name: /^精算バッチ: (新しいバッチを作成|9月の精算)$/ })
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 新しいバッチを作成')
    fireEvent.click(batchButton())
    const dialog = within(screen.getByRole('dialog', { name: '精算バッチ' }))
    expect(dialog.getByRole('button', { name: '新しいバッチを作成' })).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '9月の精算' }))
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 9月の精算')

    chooseBatchFrom(batchButton(), '新しいバッチを作成')
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 新しいバッチを作成')
  })

  it('「新しいバッチを作成」を選んでいるときだけ、精算バッチの下に「摘要がバッチの名前になります。」を出す(摘要の欄の下には出さない)', () => {
    const data = makeData()
    data.batches = [{ id: 7, name: '9月の精算', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]
    setup(data)
    const note = () => screen.queryByText('摘要がバッチの名前になります。')

    expect(note()).toBeInTheDocument()
    // 摘要の欄の下ではなく、精算バッチの欄の中にある
    expect(screen.getByLabelText('摘要').parentElement).not.toContainElement(note())
    expect(screen.getByText('精算バッチ', { selector: 'span' }).parentElement).toContainElement(note())

    chooseBatchFrom(screen.getByRole('button', { name: '精算バッチ: 新しいバッチを作成' }), '9月の精算')
    expect(note()).not.toBeInTheDocument()

    chooseBatchFrom(screen.getByRole('button', { name: '精算バッチ: 9月の精算' }), '新しいバッチを作成')
    expect(note()).toBeInTheDocument()
  })

  it('割勘仕訳のプレビューの表は、列幅を固定した同じ列の構成にする(分担相手ごとの表で、金額などの縦線がそろう)', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()

    const table = screen.getByRole('table', { name: '妻さん分の割勘仕訳' })
    const cols = Array.from(table.querySelectorAll('colgroup col')) as HTMLElement[]
    expect(cols).toHaveLength(8)
    expect(cols.every((c) => c.style.width.endsWith('%'))).toBe(true)
    expect(cols.reduce((sum, c) => sum + Number.parseFloat(c.style.width), 0)).toBeCloseTo(100)
  })

  it('摘要が空のときは、プレビューの見出しに「摘要「」」ではなく「摘要は未入力です」と出す', () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()

    const preview = screen.getByRole('region', { name: '割勘仕訳のプレビュー' })
    expect(within(preview).getByText(/摘要は未入力です/)).toBeInTheDocument()
    expect(within(preview).queryByText(/摘要「」/)).not.toBeInTheDocument()
  })

  it('既存の精算バッチを選んだときも、入力した摘要は割勘仕訳の摘要になり、バッチは作らない', async () => {
    const data = makeData()
    data.batches = [{ id: 7, name: '9月の精算', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]
    const { repositories } = setup(data)

    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '追加分' } })
    // 画面の上の絞り込みにも「精算バッチ」の欄があるので、既定で「新しいバッチを作成」が選ばれているほうのボタンを渡す
    chooseBatchFrom(screen.getByRole('button', { name: '精算バッチ: 新しいバッチを作成' }), '9月の精算')
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() => expect(repositories.journalEntryRepository.create).toHaveBeenCalled())
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ memo: string }][])[0][0]
    expect(created.memo).toBe('追加分')
    expect(repositories.settlementBatchRepository.create).not.toHaveBeenCalled()
  })

  it('仕訳画面の「この仕訳を割勘」から来たときは、その仕訳の選べる行を最初から選んだ状態にする', () => {
    setup(makeData(), { initialCheckedEntryIds: [1] })

    expect(debitBox('ランチ')).toBeChecked()
    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1200, 'JPY'))
  })

  it('行を選んでいないと「割勘を記録」は押せない', () => {
    setup()

    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeDisabled()
  })

  it('摘要のエラーは、摘要の入力欄のすぐ下に出す', async () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('摘要を入力してください')
    expect(screen.getByLabelText('摘要').parentElement).toContainElement(alert)
  })

  it('分担相手のエラーは、分担相手の欄(+ 分担相手を追加のボタンのある欄)の中に出す', async () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチの割勘' } })
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('分担相手を選んでください')
    expect(screen.getByRole('button', { name: '+ 分担相手を追加' }).parentElement).toContainElement(alert)
  })

  it('負担の合計・相手の負担額が0円などの、特定の欄に属さない注記とエラーは、「割勘を記録」ボタンの隣に出す', async () => {
    setup()
    fireEvent.click(debitBox('ランチ'))
    chooseBothPartners()
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチの割勘' } })
    const button = screen.getByRole('button', { name: '割勘を記録' })
    const commit = button.parentElement as HTMLElement

    // 負担割合の合計が100%でない注記
    fireEvent.change(screen.getByLabelText('妻の負担割合(%)'), { target: { value: '40' } })
    expect(within(commit).getByText(/合計を100%にしてください/)).toBeInTheDocument()

    // 負担が全部自分の分(相手の負担額が0円)のときの記録エラー
    fireEvent.change(screen.getByLabelText('妻の負担割合(%)'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('夫の負担割合(%)'), { target: { value: '100' } })
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('相手の負担額が0円です')
    expect(commit).toContainElement(alert)
  })

  it('分担相手を選ばずに記録しようとすると、何も作らずエラーを表示する', async () => {
    const { repositories } = setup()

    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('分担相手を選んでください')
    expect(repositories.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('負担する人を追加でき、1行になるまで外せる(最後の1行は外せない)', () => {
    setup()
    const removeButtons = () => screen.getAllByRole('button', { name: /を分担相手から外す/ })

    expect(removeButtons()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '+ 分担相手を追加' }))
    expect(removeButtons()).toHaveLength(3)
    fireEvent.click(removeButtons()[2])
    fireEvent.click(removeButtons()[1])

    expect(removeButtons()).toHaveLength(1)
    expect(removeButtons()[0]).toBeDisabled()
  })

  it('金額指定の按分に切り替えると、割合の代わりに相手ごとの金額を入力できる(複数の行を選んでいても使える)', () => {
    setup(makeData([refundEntry()]))
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(creditBox('返品'))

    fireEvent.change(screen.getByLabelText('按分の方法'), { target: { value: 'amount' } })

    expect(screen.queryByLabelText(/の負担割合/)).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/の負担額を入力/)).toHaveLength(2)
  })

  it('選んだ行の借方と貸方が差し引きで0円なら、金額を指定する按分は選べない', () => {
    const same = entry(9, '2026-10-08', '相殺', 'manual', [line(91, 9, 'debit', 1, 300), line(92, 9, 'credit', 5, 300)])
    setup(makeData([same]))

    fireEvent.click(debitBox('相殺'))
    fireEvent.click(creditBox('相殺'))

    expect(screen.getByRole('option', { name: '金額を指定する' })).toBeDisabled()
  })
})

/**
 * 割勘する行のチェックの範囲選択・トグル選択・Esc での全解除(計画Issue #235 D)。範囲は借方側・貸方側のそれぞれの中だけ。
 * 表の並びは日付の新しい順(ランチ 10/5 → コーヒー 10/4 → 映画 10/2)。
 */
describe('SplitTab: 割勘する行の範囲選択・Esc(計画Issue #235 D)', () => {
  const extra = () => [
    entry(5, '2026-10-04', 'コーヒー', 'manual', [line(51, 5, 'debit', 1, 400), line(52, 5, 'credit', 2, 400)]),
    entry(6, '2026-10-02', '映画', 'manual', [line(61, 6, 'debit', 1, 1800), line(62, 6, 'credit', 2, 1800)]),
  ]
  const flags = () => ['ランチ', 'コーヒー', '映画'].map((memo) => debitBox(memo).checked)

  it('Shift+クリックで、直前に選んだ行から押した行までが選ばれる', () => {
    setup(makeData(extra()))
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(debitBox('映画'), { shiftKey: true })
    expect(flags()).toEqual([true, true, true])
  })

  it('Ctrl+クリックで離れた行を選べ、Cmd+クリックでその行だけ外せる', () => {
    setup(makeData(extra()))
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(debitBox('映画'), { ctrlKey: true })
    expect(flags()).toEqual([true, false, true])
    fireEvent.click(debitBox('ランチ'), { metaKey: true })
    expect(flags()).toEqual([false, false, true])
  })

  it('チェックにフォーカスして Shift+↓ を押すと、次の行までが選ばれ、フォーカスが次のチェックへ移る', () => {
    setup(makeData(extra()))
    debitBox('ランチ').focus()
    fireEvent.keyDown(debitBox('ランチ'), { key: 'ArrowDown', shiftKey: true })
    expect(flags()).toEqual([true, true, false])
    expect(debitBox('コーヒー')).toHaveFocus()
  })

  it('選んだあとに Esc を押すと、選択がすべて外れる', () => {
    setup(makeData(extra()))
    fireEvent.click(debitBox('ランチ'))
    fireEvent.click(debitBox('映画'), { shiftKey: true })
    fireEvent.keyDown(debitBox('映画'), { key: 'Escape' })
    expect(flags()).toEqual([false, false, false])
  })

  it('借方の見出しのチェックで、表示中の借方の選べる行がすべて選ばれ、もう一度押すと外れる', () => {
    setup(makeData(extra()))
    fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
    expect(flags()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
    expect(flags()).toEqual([false, false, false])
  })
})

/**
 * 割勘する行の候補の150件(仕訳単位)ずつの表示(計画Issue #268)。候補は日付の新しい順で、
 * 先頭が「ランチ」(10/5)、続いて「支出{N-1}」…「支出0」(9/1、同じ日付なら id の大きい順)。
 */
describe('SplitTab: 割勘する行の150件ずつの表示(計画Issue #268)', () => {
  /** 候補が total 件ある状態(ランチ+支出0〜支出{total-2}) */
  function manyCandidates(total: number): SplitSettleData {
    const extras = Array.from({ length: total - 1 }, (_, i) =>
      entry(100 + i, '2026-09-01', `支出${i}`, 'manual', [
        line(1000 + i * 2, 100 + i, 'debit', 1, 100),
        line(1001 + i * 2, 100 + i, 'credit', 2, 100),
      ]),
    )
    return makeData(extras)
  }
  /** 表に出ている、選べる行のチェックの数(見出しの全選択と、選べない行は数えない) */
  const checkboxCount = () =>
    screen.getAllByRole('checkbox', { name: /の行を選択$/ }).filter((c) => !(c as HTMLInputElement).disabled).length

  it('150件以下のときは全件を出し、「さらに表示」は出さない', () => {
    setup(manyCandidates(150))

    expect(checkboxCount()).toBe(150)
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('150件を超えるときは、新しい150件だけを出し、「150 / 160件を表示中」と「さらに10件表示」を出す', () => {
    setup(manyCandidates(160))

    expect(checkboxCount()).toBe(150)
    expect(screen.getByText('ランチ')).toBeInTheDocument()
    expect(screen.queryByText('支出0')).not.toBeInTheDocument()
    expect(screen.getByText('150 / 160件を表示中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに10件表示' })).toBeInTheDocument()
  })

  it('「さらに10件表示」を押すと残りも出て、ボタンは消える', () => {
    setup(manyCandidates(160))

    fireEvent.click(screen.getByRole('button', { name: 'さらに10件表示' }))

    expect(checkboxCount()).toBe(160)
    expect(screen.getByText('支出0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('チェック済みの行が150件の外にあるときは、その行が見える件数まで表示を広げる', () => {
    // 支出0(id 100)は新しい順で160番目。最初から選んだ状態にすると、150件の外なので、その行を含む件数まで(全体の160件)広がる
    setup(manyCandidates(160), { initialCheckedEntryIds: [100] })

    expect(checkboxCount()).toBe(160)
    expect(debitBox('支出0')).toBeChecked()
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('チェック済みの行が150件の中にあるときは、表示を広げない', () => {
    setup(manyCandidates(160), { initialCheckedEntryIds: [149] })

    expect(checkboxCount()).toBe(150)
    expect(screen.getByRole('button', { name: 'さらに10件表示' })).toBeInTheDocument()
  })

  it('絞り込み条件を変えると、増やした表示件数は先頭の150件に戻る', () => {
    const data = manyCandidates(160)
    function Harness() {
      const [filter, setFilter] = useState<JournalEntryFilter>({})
      return (
        <SplitTab
          data={data}
          derived={deriveSplitSettle(data)}
          repositories={{} as unknown as SplitSettleRepositories}
          today="2026-10-31"
          onChanged={async () => {}}
          filter={filter}
          onFilterChange={setFilter}
          filterOpen
        />
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'さらに10件表示' }))
    expect(checkboxCount()).toBe(160)

    // 「支出」を含む摘要は159件(ランチを除く)。表示件数が戻らなければ159件すべてが出てしまう
    fireEvent.change(screen.getByRole('searchbox', { name: '摘要で検索' }), { target: { value: '支出' } })

    expect(checkboxCount()).toBe(150)
    expect(screen.getByRole('button', { name: 'さらに9件表示' })).toBeInTheDocument()
  })
})

/**
 * 候補の表の列幅の調整(仕訳一覧の明細行単位の表と同じつまみ・保存。ただし保存先は別、計画Issue #271)。
 * 摘要など見出しの右端のつまみをキーボードで動かすと幅が変わり、localStorageに保存されて次回も復元されること、
 * 借方と貸方の同じ種類の列が連動すること、「列幅を初期値に戻す」で戻ることを検証する。
 */
describe('SplitTab: 列幅の調整(計画Issue #271)', () => {
  const STORAGE_KEY = 'localbudget:split-line-table-column-widths'
  const handle = (name: string) => screen.getByRole('separator', { name })

  afterEach(() => localStorage.removeItem(STORAGE_KEY))

  it('見出しの右端に、日付・摘要・科目・取引先・世帯メンバー・金額の列幅のつまみがある', () => {
    setup()

    for (const name of ['日付', '摘要', 'コメント', '借方の科目', '貸方の科目', '借方の金額', '貸方の金額']) {
      expect(handle(`${name}の列幅`)).toBeInTheDocument()
    }
  })

  it('摘要のつまみを → キーで動かすと列幅が広がり、保存される。Home キーで初期の幅に戻る', () => {
    setup()
    const before = Number(handle('摘要の列幅').getAttribute('aria-valuenow'))

    fireEvent.keyDown(handle('摘要の列幅'), { key: 'ArrowRight' })

    expect(Number(handle('摘要の列幅').getAttribute('aria-valuenow'))).toBe(before + 8)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').memo).toBe(before + 8)
    fireEvent.keyDown(handle('摘要の列幅'), { key: 'Home' })
    expect(Number(handle('摘要の列幅').getAttribute('aria-valuenow'))).toBe(before)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('借方の科目の列幅を変えると、貸方の科目の列幅も同じ幅になる(借方・貸方で連動)', () => {
    setup()

    fireEvent.keyDown(handle('借方の科目の列幅'), { key: 'ArrowRight' })

    expect(handle('貸方の科目の列幅').getAttribute('aria-valuenow')).toBe(handle('借方の科目の列幅').getAttribute('aria-valuenow'))
  })

  it('保存した列幅は、次に開いたときに復元される', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ memo: 300 }))
    setup()

    expect(handle('摘要の列幅').getAttribute('aria-valuenow')).toBe('300')
  })

  it('列幅を変えたときだけ「列幅を初期値に戻す」が出て、押すとすべて初期の幅に戻る', () => {
    setup()
    expect(screen.queryByRole('button', { name: '列幅を初期値に戻す' })).not.toBeInTheDocument()

    fireEvent.keyDown(handle('摘要の列幅'), { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '列幅を初期値に戻す' }))

    expect(screen.queryByRole('button', { name: '列幅を初期値に戻す' })).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
