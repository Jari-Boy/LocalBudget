// @vitest-environment jsdom
/**
 * JournalTemplateTab(計画Issue #201)のコンポーネントテスト。仕訳画面の「テンプレート」タブ:
 * グループとテンプレートのツリー表示(内容・金額・状態の列)、「テンプレートを追加」で既定の内容の
 * テンプレートが作られること、右パネルでの摘要・起票者・金額の編集と1つの「保存」(名称と同時に保存)、
 * 全行の金額があって貸借が合わないときは保存できず理由が出ること、金額が空欄のまま保存できること、
 * 有効/無効の切り替えと2回押しの削除、並び順の入れ替え、摘要が未保存のまま別の行を選ぼうとしたときの
 * 確認(計画Issue #190の仕組み)を、sql.jsのNode実装(createTestDatabase)で確認する。
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
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsCounterpartyGroupRepository } from '../../infrastructure/db/SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from '../../infrastructure/db/SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalTemplateGroupRepository } from '../../infrastructure/db/SqlJsJournalTemplateGroupRepository'
import { SqlJsJournalTemplateRepository } from '../../infrastructure/db/SqlJsJournalTemplateRepository'
import { SqlJsProjectGroupRepository } from '../../infrastructure/db/SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { SqlJsSettlementBatchRepository } from '../../infrastructure/db/SqlJsSettlementBatchRepository'
import { saveUnsavedWarningEnabled } from '../common/unsaved-changes/unsavedWarningSetting'
import { UnsavedGuardHarness } from '../master/UnsavedGuardHarness'
import { JournalTemplateTab } from './JournalTemplateTab'

let db: Database
let templates: SqlJsJournalTemplateRepository
let groups: SqlJsJournalTemplateGroupRepository
let expenseId: number
let cashId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  templates = new SqlJsJournalTemplateRepository(db)
  groups = new SqlJsJournalTemplateGroupRepository(db)
  const accounts = new SqlJsAccountRepository(db)
  expenseId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  new SqlJsHouseholdMemberRepository(db).create({ name: '夫' })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderTab() {
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedGuardHarness>
        <JournalTemplateTab
          journalTemplateRepository={templates}
          journalTemplateGroupRepository={groups}
          accountRepository={new SqlJsAccountRepository(db)}
          accountGroupRepository={new SqlJsAccountGroupRepository(db)}
          counterpartyRepository={new SqlJsCounterpartyRepository(db)}
          counterpartyGroupRepository={new SqlJsCounterpartyGroupRepository(db)}
          projectRepository={new SqlJsProjectRepository(db)}
          projectGroupRepository={new SqlJsProjectGroupRepository(db)}
          householdMemberRepository={new SqlJsHouseholdMemberRepository(db)}
          settlementBatchRepository={new SqlJsSettlementBatchRepository(db)}
        />
      </UnsavedGuardHarness>
    </I18nextProvider>,
  )
}

const blankLines = () => [
  { side: 'debit' as const, accountId: expenseId, amount: null },
  { side: 'credit' as const, accountId: cashId, amount: null },
]
const panel = () => within(screen.getByRole('region', { name: 'テンプレートの編集' }))
const open = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('JournalTemplateTab: 一覧', () => {
  it('「すべてのテンプレート」の下に、グループとテンプレートが内容・金額・状態つきで並ぶ', async () => {
    const group = groups.create({ name: '食事' })
    templates.create({ name: 'コンビニ', groupId: group.id, lines: blankLines() })
    templates.create({
      name: 'ジム',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 8800 },
        { side: 'credit', accountId: cashId, amount: 8800 },
      ],
    })
    templates.deactivate(templates.create({ name: '旧', lines: blankLines() }).id)

    renderTab()

    expect(await screen.findByText('すべてのテンプレート')).toBeInTheDocument()
    const row = (name: string) => screen.getByRole('button', { name }).closest('li') as HTMLElement
    expect(screen.getByRole('button', { name: '食事' })).toBeInTheDocument()
    expect(within(row('コンビニ')).getByText('食費 / 現金')).toBeInTheDocument()
    expect(within(row('コンビニ')).getByText('起票時に入力')).toBeInTheDocument()
    expect(within(row('ジム')).getByText('￥8,800')).toBeInTheDocument()
    expect(within(row('旧')).getByText('無効')).toBeInTheDocument()
  })
})

describe('JournalTemplateTab: 見た目(仕訳一覧と同じ)', () => {
  it('左の一覧は仕訳一覧と同じカード型で、右パネルは仕訳の詳細と同じ幅の比(2:3)で出す', async () => {
    templates.create({ name: 'コンビニ', lines: blankLines() })

    renderTab()

    const card = await screen.findByRole('button', { name: 'コンビニ' })
    expect(card).toHaveClass('journal-result-list__row')
    expect(card.closest('.master-split')).toHaveClass('master-split--rule')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('JournalTemplateTab: 追加', () => {
  it('「テンプレートを追加」で、科目も金額も空のテンプレートが作られ、編集パネルが開く', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'テンプレートを追加' }))

    expect(await screen.findByRole('region', { name: 'テンプレートの編集' })).toBeInTheDocument()
    const [created] = templates.findAll()
    expect(created.name).toBe('新しいテンプレート')
    expect(created.lines.map((l) => [l.side, l.accountId, l.amount])).toEqual([
      ['debit', null, null],
      ['credit', null, null],
    ])
  })

  it('科目が空の間は、一覧の内容に「科目未設定」と出て、編集パネルに科目を選ぶよう案内が出る', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'テンプレートを追加' }))

    await screen.findByRole('region', { name: 'テンプレートの編集' })
    // フォームの状態は、パネルが出た後のuseEffectで親へ渡るため、案内は少し遅れて出る
    expect(await panel().findByText('科目が未選択の行があります')).toBeInTheDocument()
    expect(screen.getByText('科目未設定 / 科目未設定')).toBeInTheDocument()
  })

  it('科目が空のままでも、名称だけは変えて保存できる(科目を選ぶまで、摘要・金額・行の保存は求めない)', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレートを追加' }))

    await screen.findByRole('region', { name: 'テンプレートの編集' })
    // 親へフォームの状態が渡る(科目が空で不正だが未変更)のを待ってから、名称だけ変える
    await panel().findByText('科目が未選択の行があります')
    fireEvent.change(panel().getByLabelText('名称'), { target: { value: 'コンビニ' } })
    expect(panel().getByRole('button', { name: '保存' })).toBeEnabled()
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(templates.findAll()[0].name).toBe('コンビニ'))
  })

  it('科目が空のまま摘要を変えると、保存ボタンが無効になり、科目を選ぶよう案内が出る', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレートを追加' }))

    await screen.findByRole('region', { name: 'テンプレートの編集' })
    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: '昼食' } })

    await waitFor(() => expect(panel().getByRole('button', { name: '保存' })).toBeDisabled())
    expect(await panel().findByText('科目が未選択の行があります')).toBeInTheDocument()
  })

  it('同じ名前があるときは連番を付けて作る', async () => {
    templates.create({ name: '新しいテンプレート', lines: blankLines() })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'テンプレートを追加' }))

    await waitFor(() => expect(templates.findAll().map((t) => t.name)).toContain('新しいテンプレート 2'))
  })

  it('「グループを追加」でグループが作られる', async () => {
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'グループを追加' }))

    expect(await screen.findByRole('region', { name: 'グループの編集' })).toBeInTheDocument()
    expect(groups.findAll()).toHaveLength(1)
  })
})

describe('JournalTemplateTab: 編集と保存', () => {
  it('摘要・金額・名称を変えて「保存」すると、まとめて保存される', async () => {
    const created = templates.create({ name: 'コンビニ', memo: '昼食', lines: blankLines() })
    renderTab()
    await open('コンビニ')

    fireEvent.change(panel().getByLabelText('名称'), { target: { value: 'コンビニ(昼)' } })
    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: '昼ごはん' } })
    fireEvent.change(panel().getByLabelText('食費の金額'), { target: { value: '500' } })
    fireEvent.change(panel().getByLabelText('現金の金額'), { target: { value: '500' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(templates.findById(created.id)!.memo).toBe('昼ごはん'))
    const saved = templates.findById(created.id)!
    expect(saved.name).toBe('コンビニ(昼)')
    expect(saved.lines.map((l) => l.amount)).toEqual([500, 500])
  })

  it('金額が空欄のままでも保存できる', async () => {
    const created = templates.create({ name: 'A', memo: 'x', lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: 'y' } })
    fireEvent.click(panel().getByRole('button', { name: '保存' }))

    await waitFor(() => expect(templates.findById(created.id)!.memo).toBe('y'))
    expect(templates.findById(created.id)!.lines.map((l) => l.amount)).toEqual([null, null])
  })

  it('全行の金額があって貸借が合わないときは、保存ボタンが無効になり理由が出る', async () => {
    templates.create({ name: 'A', lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.change(panel().getByLabelText('食費の金額'), { target: { value: '500' } })
    fireEvent.change(panel().getByLabelText('現金の金額'), { target: { value: '400' } })

    expect(panel().getByRole('button', { name: '保存' })).toBeDisabled()
    expect(panel().getByText('借方と貸方の合計が一致していません')).toBeInTheDocument()
  })
})

describe('JournalTemplateTab: 有効/無効・削除・並び順', () => {
  it('「無効にする」で無効になり、「有効にする」で戻る', async () => {
    const created = templates.create({ name: 'A', lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.click(panel().getByRole('button', { name: '無効にする' }))
    await waitFor(() => expect(templates.findById(created.id)!.isActive).toBe(false))

    fireEvent.click(await panel().findByRole('button', { name: '有効にする' }))
    await waitFor(() => expect(templates.findById(created.id)!.isActive).toBe(true))
  })

  it('削除は2回押して確定し、テンプレートが消える', async () => {
    const created = templates.create({ name: 'A', lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.click(panel().getByRole('button', { name: '削除' }))
    expect(templates.findById(created.id)).not.toBeNull()
    fireEvent.click(await panel().findByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(templates.findById(created.id)).toBeNull())
  })

  it('「下へ」で並び順が入れ替わる', async () => {
    const first = templates.create({ name: 'A', sortOrder: 0, lines: blankLines() })
    const second = templates.create({ name: 'B', sortOrder: 1, lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.click(panel().getByRole('button', { name: '下へ' }))

    await waitFor(() => expect(templates.findById(first.id)!.sortOrder).toBe(1))
    expect(templates.findById(second.id)!.sortOrder).toBe(0)
  })

  it('所属グループを選び直すと、別のグループへ移る', async () => {
    const group = groups.create({ name: '食事' })
    const created = templates.create({ name: 'A', lines: blankLines() })
    renderTab()
    await open('A')

    fireEvent.change(panel().getByLabelText('所属グループ'), { target: { value: `g:${group.id}` } })

    await waitFor(() => expect(templates.findById(created.id)!.groupId).toBe(group.id))
  })
})

describe('JournalTemplateTab: 未保存の編集の警告(計画Issue #190)', () => {
  const dialog = () => screen.queryByRole('dialog', { name: '未保存の変更があります' })

  it('摘要が未保存のまま別の行を選ぶと確認が出て、キャンセルでは行を移らない', async () => {
    templates.create({ name: 'A', lines: blankLines() })
    templates.create({ name: 'B', lines: blankLines() })
    renderTab()
    await open('A')
    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: '編集中' } })

    fireEvent.click(screen.getByRole('button', { name: 'B' }))

    expect(dialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(dialog()).toBeNull()
    expect(panel().getByLabelText('名称')).toHaveValue('A')
  })

  it('「保存して移動」で摘要を保存してから移る', async () => {
    const a = templates.create({ name: 'A', lines: blankLines() })
    templates.create({ name: 'B', lines: blankLines() })
    renderTab()
    await open('A')
    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: '編集中' } })

    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

    await waitFor(() => expect(templates.findById(a.id)!.memo).toBe('編集中'))
    await waitFor(() => expect(panel().getByLabelText('名称')).toHaveValue('B'))
  })

  it('設定が「出さない」のときは、確認なしで別の行へ移る', async () => {
    saveUnsavedWarningEnabled(false)
    templates.create({ name: 'A', lines: blankLines() })
    templates.create({ name: 'B', lines: blankLines() })
    renderTab()
    await open('A')
    fireEvent.change(panel().getByLabelText('摘要(任意)'), { target: { value: '編集中' } })

    fireEvent.click(screen.getByRole('button', { name: 'B' }))

    expect(dialog()).toBeNull()
    await waitFor(() => expect(panel().getByLabelText('名称')).toHaveValue('B'))
  })
})
