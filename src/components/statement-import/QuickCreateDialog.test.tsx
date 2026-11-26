// @vitest-environment jsdom
/**
 * QuickCreateDialog(取引先・プロジェクトを名前でその場に追加する共通のダイアログ、計画Issue #151・#207)のコンポーネントテスト。
 * 取込・仕訳・ルール・割勘の4画面で使うため、グループの選択欄を渡さない画面(割勘)ではグループ欄が出ないこと、
 * 名前の入力欄がほかの項目と同じ見た目であること、グループを選んで作ること、その場でのグループの新規作成
 * (名前と親グループ(既定は最上位)・キャンセルで何も作らない・作ったグループがそのまま選ばれる。計画Issue #290)、追加を止める検証、作成の失敗の表示を確認する。
 * 外部依存はなし(Repositoryは持たず、呼び出し側のコールバックをvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { QuickCreateDialog, type QuickCreateDialogProps } from './QuickCreateDialog'

afterEach(cleanup)

const GROUPS = [{ id: 3, name: '旅行系', parentGroupId: null, sortOrder: 0, isActive: true }]

function renderDialog(overrides: Partial<QuickCreateDialogProps> = {}) {
  const onSubmit = vi.fn(async () => undefined)
  const onCancel = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <QuickCreateDialog title="プロジェクトを追加" nameLabel="プロジェクト名" onSubmit={onSubmit} onCancel={onCancel} {...overrides} />
    </I18nextProvider>,
  )
  return { onSubmit, onCancel }
}

const dialog = (name: string) => within(screen.getByRole('dialog', { name }))

describe('QuickCreateDialog', () => {
  it('背面は呼び出し元の中ではなくbody直下に出す(固定したタブ・バーなどの重なり順に左右されず、画面全体を暗くする。計画Issue #269)', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <div data-testid="host">
          <QuickCreateDialog title="プロジェクトを追加" nameLabel="プロジェクト名" onSubmit={vi.fn()} onCancel={vi.fn()} />
        </div>
      </I18nextProvider>,
    )

    expect(container.querySelector('.import-dialog__backdrop')).toBeNull()
    expect(document.body.querySelector(':scope > .import-dialog__backdrop')).not.toBeNull()
  })

  it('名前の入力欄はほかの項目と同じ見た目(import-control)で、名前が空の間は追加できない', () => {
    renderDialog()

    expect(screen.getByLabelText('プロジェクト名')).toHaveClass('import-control')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('名前の初期値(initialName)を渡すと入力欄に入り、そのまま追加できる(計画Issue #236)', async () => {
    const { onSubmit } = renderDialog({ title: '取引先を追加', nameLabel: '取引先名', initialName: 'スーパー 新宿店' })

    expect(screen.getByLabelText('取引先名')).toHaveValue('スーパー 新宿店')
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('スーパー 新宿店', null))
  })

  it('グループの選択欄を渡さない画面(割勘など)では、グループの欄を出さず、グループなし(null)で作る', async () => {
    const { onSubmit } = renderDialog({ title: '取引先を追加', nameLabel: '取引先名' })

    expect(screen.queryByText(/グループ/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('取引先名'), { target: { value: '新しい店' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('新しい店', null))
  })

  it('グループを選ばずに追加すると未分類(null)、選ぶとそのグループのidで作る', async () => {
    const { onSubmit } = renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS } })
    expect(screen.getByRole('button', { name: /^プロジェクトグループ: 未分類/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '夏' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith('夏', null))
  })

  it('選んだグループのidで作る', async () => {
    const { onSubmit } = renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS } })

    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '夏' } })
    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '旅行系' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('夏', 3))
  })

  it('onCreateを渡さなければ、グループ欄に「+ グループを新規追加」を出さない', () => {
    renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS } })

    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))

    expect(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).queryByRole('button', { name: '+ グループを新規追加' })).not.toBeInTheDocument()
  })

  it('「+ グループを新規追加」で名前だけを入力してグループを作ると、作ったグループがそのまま選ばれ、そのidで作成できる', async () => {
    const onCreateGroup = vi.fn(async () => 9)
    const { onSubmit } = renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS, onCreate: onCreateGroup } })
    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '夏' } })

    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
    fireEvent.change(dialog('プロジェクトグループを追加').getByLabelText('グループ名'), { target: { value: '新しい系' } })
    fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('新しい系', null))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'プロジェクトグループを追加' })).not.toBeInTheDocument())
    fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: '追加' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('夏', 9))
  })

  it('グループの追加に「親グループ」欄があり、既定は最上位(未選択)で、既存のグループを親に選べる', async () => {
    const onCreateGroup = vi.fn(async () => 9)
    renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS, onCreate: onCreateGroup } })

    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
    expect(dialog('プロジェクトグループを追加').getByRole('button', { name: /^親グループ: 最上位/ })).toBeInTheDocument()
    fireEvent.change(dialog('プロジェクトグループを追加').getByLabelText('グループ名'), { target: { value: '国内' } })
    fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: /^親グループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '親グループ' })).getByRole('button', { name: '旅行系' }))
    fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: '追加' }))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('国内', 3))
  })

  it('グループの追加の「親グループ」欄には、「+ グループを新規追加」を出さない(入れ子にしない)', () => {
    renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS, onCreate: vi.fn(async () => 9) } })

    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
    fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: /^親グループ/ }))

    expect(within(screen.getByRole('dialog', { name: '親グループ' })).queryByRole('button', { name: '+ グループを新規追加' })).not.toBeInTheDocument()
  })

  it('グループの追加をキャンセルすると、グループを作らず、選択も変わらない', () => {
    const onCreateGroup = vi.fn(async () => 9)
    renderDialog({ groupField: { label: 'プロジェクトグループ', groups: GROUPS, onCreate: onCreateGroup } })

    fireEvent.click(screen.getByRole('button', { name: /^プロジェクトグループ/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '+ グループを新規追加' }))
    fireEvent.change(dialog('プロジェクトグループを追加').getByLabelText('グループ名'), { target: { value: '取り消す系' } })
    fireEvent.click(dialog('プロジェクトグループを追加').getByRole('button', { name: 'キャンセル' }))

    expect(onCreateGroup).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'プロジェクトグループを追加' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^プロジェクトグループ: 未分類/ })).toBeInTheDocument()
  })

  it('追加の検証(validate)がfalseなら、作らずにダイアログに残る', () => {
    const { onSubmit } = renderDialog({ validate: () => false })

    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '夏' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'プロジェクトを追加' })).toBeInTheDocument()
  })

  it('作成に失敗したら、その旨を出して、追加を押し直せる', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('失敗')
    })
    renderDialog({ onSubmit })

    fireEvent.change(screen.getByLabelText('プロジェクト名'), { target: { value: '夏' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).toBeEnabled())
  })

  it('追加欄(children)を渡すと、名前・グループの下に出て、ダイアログが広がる', () => {
    renderDialog({ children: <p>追加欄の中身</p> })

    expect(screen.getByText('追加欄の中身')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'プロジェクトを追加' })).toHaveClass('import-dialog--wide')
  })
})
