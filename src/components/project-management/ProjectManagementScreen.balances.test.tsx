// @vitest-environment jsdom
/**
 * プロジェクト管理画面(計画Issue #36、計画Issue #127でテーブル形式に変更)のうち、
 * プロジェクト別のPL/BS科目残高内訳表示(summarizeProjectAccountBalances、
 * docs/domain/projects.md 1.4節)を検証するコンポーネントテスト。精算残高0による
 * 非アクティブ化提案はsettlement_batches側の機能として移設され、プロジェクトはイベント専用に
 * なったため本画面からは撤去されている(計画Issue #133)。テーブル化後はプロジェクトごとに
 * 専用の<tbody>でグルーピングされ、残高内訳パネルは同じ<tbody>内の追加行として表示されるため、
 * `.closest('tbody')`で行と展開パネルの両方を含むスコープを取得する。一覧表示・作成・編集・
 * 削除・非アクティブ化の基本操作はProjectManagementScreen.test.tsxに分離済み。sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテスト。外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../../infrastructure/db/SqlJsProjectRepository'
import { ProjectManagementScreen } from './ProjectManagementScreen'

let db: Database
let accountRepository: SqlJsAccountRepository
let projectRepository: SqlJsProjectRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
})

afterEach(cleanup)

function renderScreen() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectManagementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('ProjectManagementScreen(プロジェクト別集計)', () => {
  it('「内訳を表示」を押すと、プロジェクトに紐づく区分別の科目残高が表示される', async () => {
    const souvenir = accountRepository.create({ category: 'expense', name: 'お土産代', isReconcilable: null })
    const cash = accountRepository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const project = projectRepository.create({ name: '26年7月アメリカ旅行' })
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-15',
      memo: null,
      lines: [
        { accountId: souvenir.id, side: 'debit', amount: 5000, projectId: project.id },
        { accountId: cash.id, side: 'credit', amount: 5000 },
      ],
    })

    renderScreen()

    const item = (await screen.findByText('26年7月アメリカ旅行')).closest('tbody')!
    fireEvent.click(within(item).getByRole('button', { name: '内訳を表示' }))

    expect(within(item).getByText('お土産代')).toBeInTheDocument()
    expect(within(item).getByText('￥5,000')).toBeInTheDocument()
  })

  it('紐づく残高が1件もないプロジェクトは、内訳表示に空状態メッセージが出る', async () => {
    projectRepository.create({ name: '計画中の旅行' })

    renderScreen()

    const item = (await screen.findByText('計画中の旅行')).closest('tbody')!
    fireEvent.click(within(item).getByRole('button', { name: '内訳を表示' }))

    expect(within(item).getByText('残高のある科目がありません')).toBeInTheDocument()
  })
})
