// @vitest-environment jsdom
/**
 * AccountCreateForm(計画Issue #154)のコンポーネントテスト。
 * マスタ画面の右パネルで、既存の統合登録フロー(AccountRegistrationFlow、最大7ステップ)と
 * 同じ内容を1つのフォームで登録できることを検証する。区分に応じて設問(外部明細・残高情報・
 * 名義・初期残高)が出し分けられること、所属グループの初期選択(標準グループ)、
 * 登録処理(registerAccount / registerRevenueOrExpenseAccount)への入力、失敗時のエラー表示を
 * sql.jsのNode実装(createTestDatabase)を使って確認する。あわせて、資産・負債で任意に選べる
 * 「明細マッピング」の紐づけ(計画Issue #189: 欄の出し分け・既定のチェック・登録後の紐づけ・
 * 紐づけ失敗時の扱い)を検証する。外部依存: sql.js(ネットワークなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../../infrastructure/db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { seedStandardAccountGroups } from '../../infrastructure/db/seedStandardAccountGroups'
import type { AccountCategory } from '../../domain/account/Account'
import { AccountCreateForm } from './AccountCreateForm'

let db: Database
let accounts: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedStandardAccountGroups(db)
  accounts = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  new SqlJsHouseholdMemberRepository(db).create({ name: '夫' })
  new SqlJsHouseholdMemberRepository(db).create({ name: '妻' })
})

afterEach(cleanup)

function renderForm(initialCategory: AccountCategory = 'asset', callbacks: { onCreated?: () => void } = {}) {
  const onCreated = callbacks.onCreated ?? vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <AccountCreateForm
        accountRepository={accounts}
        journalEntryRepository={entries}
        groups={new SqlJsAccountGroupRepository(db).findAll()}
        householdMembers={new SqlJsHouseholdMemberRepository(db).findAll()}
        initialCategory={initialCategory}
        today="2026-11-07"
        onCreated={onCreated}
        onCancel={vi.fn()}
      />
    </I18nextProvider>,
  )
  return { onCreated }
}

const registered = () => accounts.findAll().filter((a) => !a.isSystemManaged)

describe('AccountCreateForm', () => {
  it('費用を選ぶと、外部明細・名義・初期残高の設問は出ず、名称と所属グループだけで登録できる', async () => {
    renderForm('expense')

    expect(screen.queryByLabelText('外部明細(CSV)はありますか?')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('名義')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('初期残高(任意)')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '食費' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(registered()).toHaveLength(1))
    expect(registered()[0]).toMatchObject({ category: 'expense', name: '食費', isReconcilable: null })
  })

  it('資産で外部明細があり残高情報も明細にあるときは、照合する科目として登録され、普通預金グループが初期選択される', async () => {
    renderForm('asset')

    expect(screen.getByLabelText('所属グループ')).toHaveDisplayValue('普通預金')
    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('残高情報は明細にありますか?'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('名義'), { target: { selectedIndex: 0 } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '楽天銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(registered()).toHaveLength(1))
    const account = registered()[0]
    expect(account).toMatchObject({ category: 'asset', name: '楽天銀行', isReconcilable: true })
    expect(account.accountGroupId).not.toBeNull()
  })

  it('外部明細がないときは、残高情報の設問を出さず、名義に「全員」を選べ、現金・電子マネーグループが初期選択される', async () => {
    renderForm('asset')

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'no' } })

    expect(screen.queryByLabelText('残高情報は明細にありますか?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('所属グループ')).toHaveDisplayValue('現金・電子マネー')
    expect(screen.getByRole('option', { name: '全員' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '現金' } })
    fireEvent.change(screen.getByLabelText('名義'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(registered()).toHaveLength(1))
    expect(registered()[0]).toMatchObject({ name: '現金', isReconcilable: false, householdMemberId: null })
  })

  it('登録時の回答として、外部明細の有無を科目に保存する(CSVあり・残高なしと、CSVなしを区別できる、計画Issue #189)', async () => {
    renderForm('liability')
    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('残高情報は明細にありますか?'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'カード未払金' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(registered()).toHaveLength(1))
    expect(registered()[0]).toMatchObject({ isReconcilable: false, hasExternalStatement: true })

    cleanup()
    renderForm('asset')
    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '現金' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(registered()).toHaveLength(2))
    expect(registered()[1]).toMatchObject({ isReconcilable: false, hasExternalStatement: false })
  })

  it('外部明細があるときは、名義に「全員」の選択肢がない', () => {
    renderForm('asset')

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'yes' } })

    expect(screen.queryByRole('option', { name: '全員' })).not.toBeInTheDocument()
  })

  it('負債を選ぶと、クレジットカードグループが初期選択される', () => {
    renderForm('liability')

    expect(screen.getByLabelText('所属グループ')).toHaveDisplayValue('クレジットカード')
  })

  it('区分を変えると、所属グループの選択肢がその区分のものに切り替わる', () => {
    renderForm('asset')

    fireEvent.change(screen.getByLabelText('区分'), { target: { value: 'liability' } })

    expect(screen.getByLabelText('所属グループ')).toHaveDisplayValue('クレジットカード')
    expect(screen.queryByRole('option', { name: '普通預金' })).not.toBeInTheDocument()
  })

  it('初期残高を入力すると、初期残高の仕訳も作られる', async () => {
    renderForm('asset')

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '現金' } })
    fireEvent.change(screen.getByLabelText('初期残高(任意)'), { target: { value: '12000' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(entries.findAll()).toHaveLength(1))
    expect(entries.findAll()[0]).toMatchObject({ sourceType: 'initial_balance', entryDate: '2026-11-07' })
  })

  it('名称が空のときは、登録ボタンが押せない', () => {
    renderForm('expense')

    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
  })

  it('登録に成功すると、作成した科目をonCreatedに渡す', async () => {
    const onCreated = vi.fn()
    renderForm('revenue', { onCreated })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '副業収入' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(onCreated.mock.calls[0][0]).toMatchObject({ name: '副業収入', category: 'revenue' })
  })

  it('登録に失敗したときは、エラーを表示し、onCreatedを呼ばない', async () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })
    const onCreated = vi.fn()
    renderForm('expense', { onCreated })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '食費' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('登録に失敗しました')
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('AccountCreateForm の明細マッピング(計画Issue #189)', () => {
  let mappings: SqlJsImportMappingDefinitionRepository
  let rakuten: number
  let smbc: number

  beforeEach(() => {
    mappings = new SqlJsImportMappingDefinitionRepository(db)
    const base = {
      dateColumn: '0',
      dateFormat: 'YYYY/MM/DD',
      descriptionColumn: '1',
      amountMode: 'single_signed' as const,
      amountColumn: '2',
    }
    rakuten = mappings.create({ ...base, formatGroupId: '楽天銀行', label: '入出金明細' }).id
    smbc = mappings.create({ ...base, formatGroupId: '三井住友銀行', label: '入出金明細(1列金額)' }).id
  })

  function renderLinkForm(
    initialCategory: AccountCategory = 'asset',
    options: {
      defaultDefinitionIds?: number[]
      repository?: Pick<SqlJsImportMappingDefinitionRepository, 'linkAccount'>
      onCreated?: () => void
    } = {},
  ) {
    const onCreated = options.onCreated ?? vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <AccountCreateForm
          accountRepository={accounts}
          journalEntryRepository={entries}
          groups={new SqlJsAccountGroupRepository(db).findAll()}
          householdMembers={new SqlJsHouseholdMemberRepository(db).findAll()}
          initialCategory={initialCategory}
          today="2026-11-07"
          mappingLinking={{
            definitions: mappings.findAll(),
            repository: options.repository ?? mappings,
            defaultDefinitionIds: options.defaultDefinitionIds,
          }}
          onCreated={onCreated}
          onCancel={vi.fn()}
        />
      </I18nextProvider>,
    )
    return { onCreated }
  }

  it('紐づけの設定を渡さない既存の使い方では、明細マッピングの欄は出ない', () => {
    renderForm('asset')

    expect(screen.queryByText('明細マッピング')).not.toBeInTheDocument()
  })

  it('資産・負債では欄が出て、収益・費用に切り替えると消える', () => {
    renderLinkForm('asset')
    expect(screen.getByRole('group', { name: '明細マッピング' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('区分'), { target: { value: 'expense' } })

    expect(screen.queryByRole('group', { name: '明細マッピング' })).not.toBeInTheDocument()
  })

  it('外部明細がないと答えると欄が消え、あると答えると出る(紐づけ先は外部明細ありの科目だけ、計画Issue #189)', () => {
    renderLinkForm('asset')
    expect(screen.getByRole('group', { name: '明細マッピング' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'no' } })
    expect(screen.queryByRole('group', { name: '明細マッピング' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'yes' } })
    expect(screen.getByRole('group', { name: '明細マッピング' })).toBeInTheDocument()
  })

  it('外部明細なしで登録するときは、チェックしていた定義があっても紐づけない', async () => {
    const { onCreated } = renderLinkForm('asset', { defaultDefinitionIds: [rakuten] })

    fireEvent.change(screen.getByLabelText('外部明細(CSV)はありますか?'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '現金' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(mappings.findById(rakuten)!.accountIds).toEqual([])
  })

  /** 「紐づける定義」の選択ツリーを開いて定義を選ぶ(科目の右パネルの「明細マッピング」と同じ部品・操作) */
  const pickDefinition = (label: string) => {
    fireEvent.click(screen.getByRole('button', { name: /^紐づける定義/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '紐づける定義' })).getByRole('button', { name: label }))
  }

  it('定義は金融機関名の見出しでまとめて選べ、初期状態では何も選ばれていない', () => {
    renderLinkForm('asset')

    fireEvent.click(screen.getByRole('button', { name: /^紐づける定義/ }))

    const dialog = within(screen.getByRole('dialog', { name: '紐づける定義' }))
    expect(dialog.getByText('楽天銀行')).toBeInTheDocument()
    expect(dialog.getByText('三井住友銀行')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('既定の定義を渡すと、最初から選ばれた状態(チップ)で表示される', () => {
    renderLinkForm('asset', { defaultDefinitionIds: [rakuten] })

    const chips = within(screen.getByRole('list'))
    expect(chips.getByText('入出金明細')).toBeInTheDocument()
    expect(chips.queryByText('入出金明細(1列金額)')).not.toBeInTheDocument()
  })

  it('選んだ定義は×で外せる', () => {
    renderLinkForm('asset', { defaultDefinitionIds: [rakuten] })

    fireEvent.click(screen.getByRole('button', { name: '入出金明細の紐づけを解除' }))

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('定義を選んで登録すると、作成した科目にその定義が紐づく', async () => {
    const { onCreated } = renderLinkForm('asset')

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '楽天銀行' } })
    pickDefinition('入出金明細')
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const created = registered()[0]
    expect(mappings.findById(rakuten)!.accountIds).toEqual([created.id])
    expect(mappings.findById(smbc)!.accountIds).toEqual([])
  })

  it('何もチェックせずに登録すると、紐づけは作られない', async () => {
    const { onCreated } = renderLinkForm('asset')

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '楽天銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(mappings.findAll().every((d) => d.accountIds.length === 0)).toBe(true)
  })

  it('紐づけが任意で、制限ではなく優先順位であることを文言で伝える', () => {
    renderLinkForm('asset')

    expect(screen.getByText(/選ばなくても、どの定義も取込のときに選べます/)).toBeInTheDocument()
  })

  it('紐づけに失敗したときは、科目は登録済みであることを伝え、閉じるまで完了にしない', async () => {
    const failing = {
      linkAccount: () => {
        throw new Error('link failed')
      },
    }
    const { onCreated } = renderLinkForm('asset', { repository: failing })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '楽天銀行' } })
    pickDefinition('入出金明細')
    fireEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('科目は登録しましたが')
    expect(registered()).toHaveLength(1)
    expect(onCreated).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
