// @vitest-environment jsdom
/**
 * はじめのチェックリスト(OnboardingChecklist)のテスト(計画Issue #177、承認済みモックアップ③)。
 * 初回セットアップを済ませた利用者の仕訳画面に、抜け漏れ防止の5項目(科目の確認・口座やクレジットカードの科目の登録・
 * 世帯メンバーの追加(任意)・最初の仕訳・バックアップ)を出す。達成はWorker側がDBの状態から求めた値を表示し、
 * 各項目のボタンで該当の画面へ移る。バックアップだけは利用者が済みにする。閉じると以後は出さない。
 * 外部依存: なし(Worker側のAPIと画面遷移は偽物を渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { OnboardingChecklist as ChecklistState } from '../../infrastructure/db/onboarding'
import { OnboardingChecklist } from './OnboardingChecklist'

afterEach(cleanup)

const BASE: ChecklistState = {
  visible: true,
  memberName: '太郎',
  accountCounts: { revenue: 3, expense: 13 },
  steps: { registerAccount: false, addMember: false, firstEntry: false, backup: false },
}

function setup(states: ChecklistState[] = [BASE]) {
  const queue = [...states]
  const api = {
    getChecklist: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0])),
    dismissChecklist: vi.fn(async () => {}),
    markBackupDone: vi.fn(async () => {}),
  }
  const onOpen = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <OnboardingChecklist api={api} onOpen={onOpen} />
    </I18nextProvider>,
  )
  return { api, onOpen }
}

const step = (title: string) => screen.getByText(title).closest('[data-step]') as HTMLElement

describe('OnboardingChecklist', () => {
  it('表示しない状態(スキップ・既存の利用者・閉じた後)では、何も出さない', async () => {
    const { api } = setup([{ ...BASE, visible: false }])
    await waitFor(() => expect(api.getChecklist).toHaveBeenCalled())

    expect(screen.queryByText('はじめのチェックリスト')).not.toBeInTheDocument()
  })

  it('状態を読めなかったときも、何も出さず画面を妨げない', async () => {
    const api = {
      getChecklist: vi.fn(async () => {
        throw new Error('失敗')
      }),
      dismissChecklist: vi.fn(),
      markBackupDone: vi.fn(),
    }
    render(
      <I18nextProvider i18n={i18n}>
        <OnboardingChecklist api={api} onOpen={vi.fn()} />
      </I18nextProvider>,
    )
    await waitFor(() => expect(api.getChecklist).toHaveBeenCalled())

    expect(screen.queryByText('はじめのチェックリスト')).not.toBeInTheDocument()
  })

  it('5つの項目を並べ、「勘定科目を確認する」は最初から済みで、入った科目の件数を示す', async () => {
    setup()

    expect(await screen.findByText('はじめのチェックリスト')).toBeInTheDocument()
    for (const title of [
      '勘定科目を確認する',
      '口座やクレジットカードの科目を登録する',
      '世帯メンバーを追加する(任意)',
      '最初の仕訳を記録する',
      'バックアップを1度取る',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(step('勘定科目を確認する')).toHaveAttribute('data-done', 'true')
    expect(step('勘定科目を確認する')).toHaveTextContent('収益3・費用13の科目と、資産の「現金」が入りました')
    expect(screen.getByText('1 / 5 完了')).toBeInTheDocument()
  })

  it('世帯メンバーの項目に、いまの名前を出す', async () => {
    setup()

    await screen.findByText('はじめのチェックリスト')

    expect(step('世帯メンバーを追加する(任意)')).toHaveTextContent('いまは「太郎」の1名です')
  })

  it('達成した項目は済みで表示し、完了の件数に数える', async () => {
    setup([{ ...BASE, steps: { registerAccount: true, addMember: false, firstEntry: true, backup: false } }])

    await screen.findByText('はじめのチェックリスト')

    expect(step('口座やクレジットカードの科目を登録する')).toHaveAttribute('data-done', 'true')
    expect(step('最初の仕訳を記録する')).toHaveAttribute('data-done', 'true')
    expect(step('世帯メンバーを追加する(任意)')).toHaveAttribute('data-done', 'false')
    expect(screen.getByText('3 / 5 完了')).toBeInTheDocument()
  })

  it('各項目のボタンで、該当の画面へ移る', async () => {
    const { onOpen } = setup()
    await screen.findByText('はじめのチェックリスト')

    fireEvent.click(within(step('勘定科目を確認する')).getByRole('button', { name: 'マスタを開く' }))
    fireEvent.click(within(step('口座やクレジットカードの科目を登録する')).getByRole('button', { name: '科目を登録' }))
    fireEvent.click(within(step('世帯メンバーを追加する(任意)')).getByRole('button', { name: 'メンバー設定' }))
    fireEvent.click(within(step('最初の仕訳を記録する')).getByRole('button', { name: '起票 / 明細取込' }))
    fireEvent.click(within(step('バックアップを1度取る')).getByRole('button', { name: '設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '用語集を開く(世帯メンバー・精算バッチなど)' }))

    expect(onOpen.mock.calls.map(([path]) => path)).toEqual([
      '/master/accounts',
      '/master/accounts',
      '/master/household-members',
      '/journal/create/import',
      '/settings',
      '/glossary',
    ])
  })

  it('バックアップの項目は、利用者が「済みにする」と記録して、状態を取り直す', async () => {
    const { api } = setup([BASE, { ...BASE, steps: { ...BASE.steps, backup: true } }])
    await screen.findByText('はじめのチェックリスト')

    fireEvent.click(screen.getByRole('button', { name: 'バックアップを済みにする' }))

    await waitFor(() => expect(step('バックアップを1度取る')).toHaveAttribute('data-done', 'true'))
    expect(api.markBackupDone).toHaveBeenCalledTimes(1)
  })

  it('「チェックリストを閉じる」で、記録して画面から消す', async () => {
    const { api } = setup()
    await screen.findByText('はじめのチェックリスト')

    fireEvent.click(screen.getByRole('button', { name: 'チェックリストを閉じる' }))

    await waitFor(() => expect(screen.queryByText('はじめのチェックリスト')).not.toBeInTheDocument())
    expect(api.dismissChecklist).toHaveBeenCalledTimes(1)
  })
})
