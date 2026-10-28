// @vitest-environment jsdom
/**
 * 勘定科目グループ管理画面(計画Issue #129)のコンポーネントテスト。
 * 「資産/負債/収益/費用」4セクション構成でのツリー表示、セクション単位のグループ追加
 * (categoryは作成したセクションで自動的に決まる)、すべて展開/折りたたみ、
 * グループ名のインライン編集(ダブルクリック/Enter)、チェックボックス選択+移動先指定に
 * よる単体/一括移動(categoryが揃っていない場合の拒否を含む)、ドラッグ&ドロップ
 * (3ゾーン方式: 兄弟挿入/ネスト、category境界を越える操作の拒否とエラー表示)、
 * 既存の確立済みルール(削除可否判定・非アクティブ化)の維持を、sql.jsのNode実装
 * (createTestDatabase)を使った統合的なレンダリングテストとして検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { AccountGroupManagementScreen } from './AccountGroupManagementScreen'

let db: Database
let accountGroupRepository: SqlJsAccountGroupRepository
let accountRepository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountGroupRepository = new SqlJsAccountGroupRepository(db)
  accountRepository = new SqlJsAccountRepository(db)
})

afterEach(cleanup)

function renderScreen(onBack: () => void = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountGroupManagementScreen
        accountGroupRepository={accountGroupRepository}
        accountRepository={accountRepository}
        onBack={onBack}
      />
    </I18nextProvider>,
  )
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
}

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [],
    effectAllowed: 'move',
    dropEffect: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    setDragImage: () => {},
    clearData: () => store.clear(),
  } as unknown as DataTransfer
}

function mockRowRect(element: Element) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 40,
    left: 0,
    right: 200,
    width: 200,
    height: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function getRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-row-id]') as HTMLElement
}

/**
 * jsdomはDragEventを実装しておらず、testing-libraryのfireEvent.dragOver/dropは
 * clientYを含むinitを渡してもEventコンストラクタに無視される(clientYはMouseEvent/
 * DragEvent固有のプロパティのため)。createEventで素のEventを作ってからclientYを
 * 直接プロパティとして上書きし、それをdispatchすることで迂回する。
 */
function fireDragEventWithClientY(
  type: 'dragOver' | 'drop',
  element: Element,
  dataTransfer: DataTransfer,
  clientY: number,
) {
  const event = createEvent[type](element, { dataTransfer })
  Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
  fireEvent(element, event)
}

describe('ツリー表示(4セクション構成)', () => {
  it('グループが無い場合、4セクション見出しとも「まだグループがありません」が表示される', async () => {
    renderScreen()
    await waitForLoaded()

    expect(screen.getByText('資産')).toBeInTheDocument()
    expect(screen.getByText('負債')).toBeInTheDocument()
    expect(screen.getByText('収益')).toBeInTheDocument()
    expect(screen.getByText('費用')).toBeInTheDocument()
  })

  it('ルートグループがそのcategoryのセクション直下に表示される', async () => {
    accountGroupRepository.create({ name: '現金同等物', category: 'asset' })
    accountGroupRepository.create({ name: 'クレカ', category: 'liability' })

    renderScreen()

    expect(await screen.findByText('現金同等物')).toBeInTheDocument()
    expect(await screen.findByText('クレカ')).toBeInTheDocument()
  })

  it('サブグループ・直属科目は折りたたまれており、展開するまで表示されない', async () => {
    const parent = accountGroupRepository.create({ name: '現金同等物', category: 'asset' })
    accountRepository.create({ category: 'asset', name: '現金', isReconcilable: true, accountGroupId: parent.id })

    renderScreen()
    await screen.findByText('現金同等物')

    expect(screen.queryByText('現金')).not.toBeInTheDocument()
  })

  it('「すべて展開する」で全グループが展開され、科目まで表示される', async () => {
    const parent = accountGroupRepository.create({ name: '現金同等物', category: 'asset' })
    accountRepository.create({ category: 'asset', name: '現金', isReconcilable: true, accountGroupId: parent.id })
    renderScreen()
    await screen.findByText('現金同等物')

    fireEvent.click(screen.getByRole('button', { name: 'すべて展開する' }))

    expect(await screen.findByText('現金')).toBeInTheDocument()
  })

  it('展開後に「すべて折りたたむ」を押すと再び折りたたまれる', async () => {
    const parent = accountGroupRepository.create({ name: '現金同等物', category: 'asset' })
    accountRepository.create({ category: 'asset', name: '現金', isReconcilable: true, accountGroupId: parent.id })
    renderScreen()
    await screen.findByText('現金同等物')
    fireEvent.click(screen.getByRole('button', { name: 'すべて展開する' }))
    await screen.findByText('現金')

    fireEvent.click(screen.getByRole('button', { name: 'すべて折りたたむ' }))

    expect(screen.queryByText('現金')).not.toBeInTheDocument()
  })
})

describe('セクション単位のグループ追加', () => {
  it('「資産」セクションの追加ボタンから作成すると、categoryがassetになる', async () => {
    renderScreen()
    await waitForLoaded()
    const assetSection = screen.getByText('資産').closest('[data-section]') as HTMLElement

    fireEvent.click(within(assetSection).getByRole('button', { name: '+ グループを追加' }))
    fireEvent.change(screen.getByLabelText('グループ名'), { target: { value: '現金同等物' } })
    fireEvent.click(screen.getByRole('button', { name: '追加する' }))

    await screen.findByText('現金同等物')
    const created = accountGroupRepository.findAll().find((g) => g.name === '現金同等物')
    expect(created?.category).toBe('asset')
    expect(created?.parentGroupId).toBeNull()
  })

  it('「負債」セクションの追加ボタンから作成すると、categoryがliabilityになる', async () => {
    renderScreen()
    await waitForLoaded()
    const section = screen.getByText('負債').closest('[data-section]') as HTMLElement

    fireEvent.click(within(section).getByRole('button', { name: '+ グループを追加' }))
    fireEvent.change(screen.getByLabelText('グループ名'), { target: { value: 'クレカ' } })
    fireEvent.click(screen.getByRole('button', { name: '追加する' }))

    await screen.findByText('クレカ')
    expect(accountGroupRepository.findAll().find((g) => g.name === 'クレカ')?.category).toBe('liability')
  })
})

describe('グループ名のインライン編集', () => {
  it('ダブルクリックで編集モードになり、保存すると名前が変わる', async () => {
    accountGroupRepository.create({ name: '水道光熱費', category: 'expense' })
    renderScreen()
    const nameEl = await screen.findByText('水道光熱費')

    fireEvent.doubleClick(nameEl)
    fireEvent.change(screen.getByLabelText('水道光熱費 の新しい名前'), { target: { value: '光熱費' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('光熱費')).toBeInTheDocument()
  })

  it('Enterキーでも編集モードに入れる(キーボード操作)', async () => {
    accountGroupRepository.create({ name: '水道光熱費', category: 'expense' })
    renderScreen()
    const nameEl = await screen.findByText('水道光熱費')

    fireEvent.keyDown(nameEl, { key: 'Enter' })

    expect(screen.getByLabelText('水道光熱費 の新しい名前')).toBeInTheDocument()
  })

  it('キャンセルすると編集前の名前のままになる', async () => {
    accountGroupRepository.create({ name: '水道光熱費', category: 'expense' })
    renderScreen()
    const nameEl = await screen.findByText('水道光熱費')
    fireEvent.doubleClick(nameEl)
    fireEvent.change(screen.getByLabelText('水道光熱費 の新しい名前'), { target: { value: '光熱費' } })

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(await screen.findByText('水道光熱費')).toBeInTheDocument()
  })
})

describe('チェックボックス選択+移動先指定(キーボード操作対応)', () => {
  it('科目を1件選択して移動先を選ぶと、そのグループへ移動する', async () => {
    const groupA = accountGroupRepository.create({ name: 'A', category: 'expense' })
    const groupB = accountGroupRepository.create({ name: 'B', category: 'expense' })
    accountRepository.create({ category: 'expense', name: '電気代', isReconcilable: null, accountGroupId: groupA.id })
    renderScreen()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'すべて展開する' }))
    const accountRow = await screen.findByText('電気代')

    fireEvent.click(within(getRow('電気代')).getByRole('checkbox'))
    const select = screen.getByRole('combobox', { name: '選択した項目の移動先を選択' })
    fireEvent.change(select, {
      target: { value: within(select).getByText('B').closest('option')!.getAttribute('value') },
    })

    await waitFor(() =>
      expect(accountRepository.findAll().find((a) => a.name === '電気代')?.accountGroupId).toBe(groupB.id),
    )
    expect(accountRow).toBeInTheDocument()
  })

  it('categoryが異なる項目を同時に選択すると、移動先は提示されずメッセージが表示される', async () => {
    const assetGroup = accountGroupRepository.create({ name: '資産グループ', category: 'asset' })
    const expenseGroup = accountGroupRepository.create({ name: '費用グループ', category: 'expense' })
    renderScreen()
    await screen.findByText('資産グループ')

    fireEvent.click(within(getRow('資産グループ')).getByRole('checkbox'))
    fireEvent.click(within(getRow('費用グループ')).getByRole('checkbox'))

    expect(
      await screen.findByText('区分が異なる項目が含まれるため、まとめて移動できません'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '選択した項目の移動先を選択' })).not.toBeInTheDocument()
    void assetGroup
    void expenseGroup
  })
})

describe('ドラッグ&ドロップ', () => {
  it('グループ行の中央(ネストゾーン)にドロップすると、子グループになる', async () => {
    accountGroupRepository.create({ name: '現金同等物', category: 'asset' })
    accountGroupRepository.create({ name: 'ネット銀行', category: 'asset' })
    renderScreen()
    await screen.findByText('現金同等物')
    const sourceRow = getRow('ネット銀行')
    const targetRow = getRow('現金同等物')
    mockRowRect(targetRow)
    const dataTransfer = createDataTransfer()

    fireEvent.dragStart(sourceRow, { dataTransfer })
    fireEvent.dragEnter(targetRow, { dataTransfer })
    fireDragEventWithClientY('dragOver', targetRow, dataTransfer, 20)
    fireDragEventWithClientY('drop', targetRow, dataTransfer, 20)

    await waitFor(() => {
      const moved = accountGroupRepository.findAll().find((g) => g.name === 'ネット銀行')
      const parent = accountGroupRepository.findAll().find((g) => g.name === '現金同等物')
      expect(moved?.parentGroupId).toBe(parent?.id)
    })
  })

  it('グループ行の上端(兄弟挿入ゾーン)にドロップすると、階層を変えず並び順だけ変わる', async () => {
    const a = accountGroupRepository.create({ name: 'A', category: 'expense' })
    const b = accountGroupRepository.create({ name: 'B', category: 'expense' })
    renderScreen()
    await screen.findByText('A')
    const sourceRow = getRow('B')
    const targetRow = getRow('A')
    mockRowRect(targetRow)
    const dataTransfer = createDataTransfer()

    fireEvent.dragStart(sourceRow, { dataTransfer })
    fireEvent.dragEnter(targetRow, { dataTransfer })
    fireDragEventWithClientY('dragOver', targetRow, dataTransfer, 2)
    fireDragEventWithClientY('drop', targetRow, dataTransfer, 2)

    await waitFor(() => {
      const movedB = accountGroupRepository.findAll().find((g) => g.id === b.id)
      const stillA = accountGroupRepository.findAll().find((g) => g.id === a.id)
      expect(movedB!.parentGroupId).toBeNull()
      expect(movedB!.sortOrder).toBeLessThan(stillA!.sortOrder)
    })
  })

  it('categoryが異なるグループへのドロップは拒否され、エラーメッセージが表示される', async () => {
    accountGroupRepository.create({ name: '資産グループ', category: 'asset' })
    accountGroupRepository.create({ name: '費用グループ', category: 'expense' })
    renderScreen()
    await screen.findByText('資産グループ')
    const sourceRow = getRow('資産グループ')
    const targetRow = getRow('費用グループ')
    mockRowRect(targetRow)
    const dataTransfer = createDataTransfer()

    fireEvent.dragStart(sourceRow, { dataTransfer })
    fireEvent.dragEnter(targetRow, { dataTransfer })
    fireDragEventWithClientY('dragOver', targetRow, dataTransfer, 20)
    fireDragEventWithClientY('drop', targetRow, dataTransfer, 20)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const unchanged = accountGroupRepository.findAll().find((g) => g.name === '資産グループ')
    expect(unchanged?.parentGroupId).toBeNull()
  })
})

describe('既存の確立済みルールの維持', () => {
  it('子グループ・所属科目がともに0件のグループには削除アイコンが表示される', async () => {
    accountGroupRepository.create({ name: '使わないグループ', category: 'expense' })
    renderScreen()
    const row = getRow(await (await screen.findByText('使わないグループ')).textContent!)

    expect(within(row).getByRole('button', { name: '削除' })).toBeInTheDocument()
  })

  it('所属する勘定科目があるグループには削除アイコンが表示されない', async () => {
    const group = accountGroupRepository.create({ name: '水道光熱費', category: 'expense' })
    accountRepository.create({ category: 'expense', name: '電気代', isReconcilable: null, accountGroupId: group.id })
    renderScreen()
    await screen.findByText('水道光熱費')
    const row = getRow('水道光熱費')

    expect(within(row).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('is_active = trueのグループを非アクティブ化できる', async () => {
    accountGroupRepository.create({ name: '使わなくなった分類', category: 'expense' })
    renderScreen()
    await screen.findByText('使わなくなった分類')
    const row = getRow('使わなくなった分類')

    fireEvent.click(within(row).getByRole('button', { name: '非アクティブ化' }))

    await waitFor(() => expect(row).toHaveTextContent('非アクティブ'))
  })

  it('戻るボタンを押すとonBackが呼ばれる', async () => {
    const onBack = vi.fn()
    renderScreen(onBack)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
