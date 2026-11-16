// @vitest-environment jsdom
/**
 * 初回セットアップのゲート(OnboardingGate)とウェルカム・初期設定の画面のテスト(計画Issue #177、承認済みモックアップ①②)。
 * 完了済み(既存の利用者を含む)ならアプリ本体を出し、未完了のときだけウェルカム → 初期設定の順に出す。
 * 初期設定は、世帯メンバーの名前(必須)・保存先・科目テンプレートを1画面で決め、「この設定で始める」で確定する。
 * フォルダ保存を選んだときは、フォルダを先に選び(ブラウザは操作の直後にしか選ばせない)、設定を確定してから、
 * 保存先を切り替えてページを再読み込みする。
 * ウェルカム画面は「初期設定へ進む」だけを置く(用語集・スキップのボタンは無い)。外部依存: なし(Worker側のAPI・フォルダ選択・再読み込みは偽物を渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { FolderDatabaseInfo } from '../../infrastructure/storage/describeFolderDatabase'
import { OnboardingGate, type OnboardingGateProps } from './OnboardingGate'

afterEach(cleanup)

function fakeFolder(name = '家計簿'): FileSystemDirectoryHandle {
  return { name } as unknown as FileSystemDirectoryHandle
}

function setup(overrides: Partial<OnboardingGateProps> & { completed?: boolean } = {}) {
  const { completed = false, ...rest } = overrides
  const onboarding = {
    getStatus: vi.fn(async () => ({ completed })),
    complete: vi.fn(async () => {}),
  }
  const storage = { moveToFolder: vi.fn(async () => {}) }
  const folderPicker = {
    isSupported: true,
    pick: vi.fn(async () => fakeFolder()),
    describe: vi.fn(async (): Promise<FolderDatabaseInfo | null> => null),
  }
  const reload = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <OnboardingGate onboarding={onboarding} storage={storage} folderPicker={folderPicker} reload={reload} {...rest}>
        <div>アプリ本体</div>
      </OnboardingGate>
    </I18nextProvider>,
  )
  return { onboarding, storage, folderPicker, reload }
}

async function openSetup() {
  fireEvent.click(await screen.findByRole('button', { name: '初期設定へ進む' }))
}

const nameInput = () => screen.getByRole('textbox', { name: 'あなたの名前' })
const startButton = () => screen.getByRole('button', { name: 'この設定で始める' })

describe('OnboardingGate', () => {
  it('状態を確認している間は「読み込み中」を出し、アプリ本体もウェルカムも出さない', () => {
    setup()

    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    expect(screen.queryByText('アプリ本体')).not.toBeInTheDocument()
  })

  it('完了済み(既存の利用者を含む)なら、ウェルカムを出さずにアプリ本体を出す', async () => {
    setup({ completed: true })

    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '初期設定へ進む' })).not.toBeInTheDocument()
  })

  it('未完了なら、ウェルカム画面を出し、アプリ本体は出さない', async () => {
    setup()

    expect(await screen.findByRole('button', { name: '初期設定へ進む' })).toBeInTheDocument()
    expect(screen.getByText('複式簿記で記帳する、サーバーを持たない家計簿です。')).toBeInTheDocument()
    expect(screen.queryByText('アプリ本体')).not.toBeInTheDocument()
  })

  it('「前提」の説明は、「LocalBudgetは複式簿記の家計簿アプリです。」と「複式簿記の知識を前提にしています。」の2行である', async () => {
    setup()
    await screen.findByRole('button', { name: '初期設定へ進む' })

    const premise = screen.getByText('前提').closest('.onboarding__fact') as HTMLElement
    const lines = within(premise).getAllByText(/./, { selector: 'p' }).map((p) => p.textContent)
    expect(lines).toEqual(['LocalBudgetは複式簿記の家計簿アプリです。', '複式簿記の知識を前提にしています。'])
  })

  it('ウェルカムは、前提とデータの置き場所(消えるリスク)だけを示し、「最初に入るもの」は出さない', async () => {
    setup()
    await screen.findByRole('button', { name: '初期設定へ進む' })

    expect(screen.getByText('前提')).toBeInTheDocument()
    expect(screen.getByText('データの置き場所')).toBeInTheDocument()
    expect(screen.getByText(/バックアップは自分で取る必要があります/)).toBeInTheDocument()
    expect(screen.queryByText('最初に入るもの')).not.toBeInTheDocument()
  })

  it('「初期設定へ進む」で、名前・保存先・科目テンプレートの初期設定画面へ移る', async () => {
    setup()
    await openSetup()

    expect(screen.getByRole('heading', { name: 'あなたの名前' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '保存先' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '勘定科目のテンプレート' })).toBeInTheDocument()
  })

  it('名前が空の間は「この設定で始める」を押せず、入力すると押せる', async () => {
    setup()
    await openSetup()
    expect(startButton()).toBeDisabled()

    fireEvent.change(nameInput(), { target: { value: '太郎' } })

    expect(startButton()).toBeEnabled()
  })

  it('空白だけの名前は未入力として扱う', async () => {
    setup()
    await openSetup()

    fireEvent.change(nameInput(), { target: { value: '   ' } })

    expect(startButton()).toBeDisabled()
  })

  it('入力欄から離れても名前が空なら、入力を促すメッセージを出す', async () => {
    setup()
    await openSetup()

    fireEvent.blur(nameInput())

    expect(screen.getByText('名前を入力してください。')).toBeInTheDocument()
  })

  it('テンプレートの初期値は「標準」で、プレビューは5区分を出す(現金・雑収入・初期残高を含む)', async () => {
    setup()
    await openSetup()

    expect(screen.getByRole('radio', { name: /標準/ })).toBeChecked()
    for (const heading of ['資産', '負債', '純資産', '収益', '費用']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${heading}`) })).toBeInTheDocument()
    }
    const preview = screen.getByTestId('template-preview')
    expect(within(preview).getByText('現金')).toBeInTheDocument()
    expect(within(preview).getByText('初期残高')).toBeInTheDocument()
    expect(within(preview).getByText('雑収入')).toBeInTheDocument()
    expect(within(preview).getByText('副業収入')).toBeInTheDocument()
  })

  it('テンプレートを「最小」に変えると、プレビューから副業収入が消える。「簿記寄り」では所得税が増える', async () => {
    setup()
    await openSetup()
    const preview = () => within(screen.getByTestId('template-preview'))

    fireEvent.click(screen.getByRole('radio', { name: /最小/ }))
    expect(preview().queryByText('副業収入')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /簿記寄り/ }))
    expect(preview().getByText('所得税')).toBeInTheDocument()
  })

  it('「この設定で始める」で、前後の空白を除いた名前と選んだテンプレートを確定し、アプリ本体へ進む', async () => {
    const { onboarding } = setup()
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: ' 太郎 ' } })
    fireEvent.click(screen.getByRole('radio', { name: /簿記寄り/ }))

    fireEvent.click(startButton())

    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
    expect(onboarding.complete).toHaveBeenCalledWith({ memberName: '太郎', template: 'bookkeeping' })
  })

  it('確定に失敗したときは、理由を出して初期設定にとどまる(アプリ本体は出さない)', async () => {
    const { onboarding } = setup()
    onboarding.complete.mockRejectedValueOnce(new Error('失敗'))
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })

    fireEvent.click(startButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('設定を保存できませんでした')
    expect(screen.queryByText('アプリ本体')).not.toBeInTheDocument()
  })

  it('初期設定の「戻る」で、ウェルカムへ戻る', async () => {
    setup()
    await openSetup()

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(screen.getByRole('button', { name: '初期設定へ進む' })).toBeInTheDocument()
  })

  it('ウェルカムには「初期設定へ進む」だけを置き、「用語集を見る」「あとで設定する」のボタンも、「設定はあとから変更できます」の但し書きも無い', async () => {
    setup()
    await screen.findByRole('button', { name: '初期設定へ進む' })

    expect(screen.queryByRole('button', { name: '用語集を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'あとで設定する' })).not.toBeInTheDocument()
    expect(screen.queryByText('設定はあとから変更できます')).not.toBeInTheDocument()
  })
})

describe('OnboardingGate の保存先', () => {
  it('保存先の初期値は「このブラウザ内」で、確定してもフォルダ選択・再読み込みはしない', async () => {
    const { folderPicker, reload } = setup()
    await openSetup()
    expect(screen.getByRole('radio', { name: /このブラウザ内/ })).toBeChecked()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })

    fireEvent.click(startButton())

    await screen.findByText('アプリ本体')
    expect(folderPicker.pick).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('フォルダ保存に未対応のブラウザでは、「フォルダに保存」を選べず、対応ブラウザを案内する', async () => {
    setup({
      folderPicker: { isSupported: false, pick: vi.fn(), describe: vi.fn() },
    })
    await openSetup()

    expect(screen.getByRole('radio', { name: /フォルダに保存/ })).toBeDisabled()
  })

  it('「フォルダに保存」を選んで始めると、フォルダ選択→確定→今のデータをコピー→再読み込みの順に行う', async () => {
    const { onboarding, storage, folderPicker, reload } = setup()
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: /フォルダに保存/ }))

    fireEvent.click(startButton())

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(onboarding.complete).toHaveBeenCalledTimes(1)
    expect(folderPicker.pick).toHaveBeenCalledTimes(1)
    expect(storage.moveToFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '家計簿' }), 'copy')
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]
    expect(order(folderPicker.pick)).toBeLessThan(order(onboarding.complete))
    expect(order(onboarding.complete)).toBeLessThan(order(storage.moveToFolder))
  })

  it('選んだフォルダに既にDBファイルがあるときは、上書きせずそのファイルを開く', async () => {
    const info: FolderDatabaseInfo = { size: 1024, lastModified: 0 } as FolderDatabaseInfo
    const { storage, reload } = setup()
    await openSetup()
    // setupの偽物を差し替えるため、describeの戻りを変える
    cleanup()
    const folderPicker = {
      isSupported: true,
      pick: vi.fn(async () => fakeFolder('同期フォルダ')),
      describe: vi.fn(async () => info),
    }
    const second = setup({ folderPicker })
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: /フォルダに保存/ }))

    fireEvent.click(startButton())

    await waitFor(() => expect(second.reload).toHaveBeenCalledTimes(1))
    expect(second.storage.moveToFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '同期フォルダ' }), 'open')
    expect(storage.moveToFolder).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('フォルダの選択を取りやめたときは、ブラウザ内のまま、再読み込みせずアプリ本体へ進む', async () => {
    const folderPicker = {
      isSupported: true,
      pick: vi.fn(async () => null),
      describe: vi.fn(async () => null),
    }
    const { storage, reload } = setup({ folderPicker })
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: /フォルダに保存/ }))

    fireEvent.click(startButton())

    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
    expect(storage.moveToFolder).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('フォルダへの切り替えに失敗したときは、ブラウザ内のまま使えることを伝え、アプリ本体へ進める', async () => {
    const { storage } = setup()
    storage.moveToFolder.mockRejectedValueOnce(new Error('失敗'))
    await openSetup()
    fireEvent.change(nameInput(), { target: { value: '太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: /フォルダに保存/ }))

    fireEvent.click(startButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('フォルダに保存できませんでした')
    fireEvent.click(screen.getByRole('button', { name: 'このブラウザ内のまま始める' }))
    expect(await screen.findByText('アプリ本体')).toBeInTheDocument()
  })
})
