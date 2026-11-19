// @vitest-environment jsdom
/**
 * 選択ツリー(TreeSelect)のお気に入り(計画Issue #231 フェーズ4)のコンポーネントテスト。
 * 先頭の「★ お気に入り」のセクション(お気に入りが無ければ出さない、検索で絞り込む)、各項目の★のボタン(押すとお気に入りを
 * 付け外しでき、項目は選ばず、ポップアップも閉じない。押下状態と名前を持つ。矢印キーの移動はたどらず、Tabで届く)、
 * お気に入りのセクションの項目を選ぶと従来どおり選択されて閉じること、種類(favoriteKind)ごとに別のお気に入りを見ること、
 * プロバイダーが無いとき(favoriteKindを渡しても)従来の見た目のままであることを検証する。複数選択でも★は選択を変えない。
 * 外部依存なし(Repositoryは差し替えたテスト用の実装)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoritesProvider, type FavoriteRepository } from '../favorites/FavoritesContext'
import { TreeSelect, type TreeSelectProps } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

/** 値は科目などのid(文字列)、名称は表示名 */
const item = (id: number, name: string, isActive = true) => ({ kind: 'item' as const, value: String(id), name, isActive })

const categories: TreeSelectCategory[] = [
  {
    key: 'expense',
    name: '費用',
    nodes: [
      { kind: 'group', id: 'daily', name: '日常', children: [item(1, '食費'), item(2, '交通費'), item(3, '日用品費')] },
      item(4, '交際費'),
    ],
  },
]

function repository(initial: number[]) {
  let ids = [...initial]
  const findFavoriteIds = vi.fn(async () => [...ids])
  const setFavorite = vi.fn(async (id: number, isFavorite: boolean) => {
    ids = isFavorite ? [...ids, id] : ids.filter((x) => x !== id)
  })
  const repo: FavoriteRepository = { findFavoriteIds, setFavorite }
  return { repo, setFavorite }
}

type SingleProps = Extract<TreeSelectProps, { value: string }>

function setup(options: { account?: number[]; counterparty?: number[]; props?: Partial<SingleProps>; withProvider?: boolean } = {}) {
  const account = repository(options.account ?? [])
  const counterparty = repository(options.counterparty ?? [])
  const onChange = vi.fn()
  const select = (
    <TreeSelect label="科目" categories={categories} value="" onChange={onChange} favoriteKind="account" {...options.props} />
  )
  render(
    options.withProvider === false ? (
      select
    ) : (
      <FavoritesProvider repositories={{ account: account.repo, counterparty: counterparty.repo, project: repository([]).repo }} refreshKey="a">
        {select}
      </FavoritesProvider>
    ),
  )
  return { account, counterparty, onChange }
}

const trigger = () => screen.getByRole('button', { name: /^科目/ })
const popup = () => screen.getByRole('dialog', { name: '科目' })
const open = async () => {
  fireEvent.click(trigger())
  return within(popup())
}
const star = (scope: ReturnType<typeof within>, name: string, on: boolean) =>
  scope.getAllByRole('button', { name: `${name}をお気に入り${on ? 'から外す' : 'に追加'}` })

describe('TreeSelect: お気に入り', () => {
  it('お気に入りがあると、先頭に「★ お気に入り」の見出しとお気に入りの項目を出し、そのあとに従来のツリーを出す', async () => {
    setup({ account: [1, 4] })
    await waitFor(() => expect(trigger()).toBeInTheDocument())
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })

    const list = within(popup())
    // お気に入り(食費・交際費)がセクションに並び、ツリーの側の交際費にも出る(日常のグループは閉じているので食費は出ない)
    expect(list.getAllByRole('button', { name: '交際費' })).toHaveLength(2)
    expect(list.getAllByRole('button', { name: '食費' })).toHaveLength(1)
    expect(list.getByText('費用')).toBeInTheDocument()
  })

  it('お気に入りが0件のときは、セクションを出さない。★のボタンは、いつも出す', async () => {
    setup()
    const list = await open()

    expect(list.queryByText('★ お気に入り')).not.toBeInTheDocument()
    expect(star(list, '交際費', false)).toHaveLength(1)
  })

  it('★のボタンを押すと、お気に入りに追加でき(保存して、セクションに現れ)、項目は選ばず、ポップアップも閉じない。もう一度押すと外れる', async () => {
    const { account, onChange } = setup()
    let list = await open()

    fireEvent.click(star(list, '交際費', false)[0])

    await waitFor(() => expect(account.setFavorite).toHaveBeenCalledWith(4, true))
    expect(onChange).not.toHaveBeenCalled()
    expect(popup()).toBeInTheDocument()
    await waitFor(() => expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument())
    list = within(popup())
    expect(star(list, '交際費', true)).toHaveLength(2)
    expect(star(list, '交際費', true)[0]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(star(list, '交際費', true)[0])
    await waitFor(() => expect(account.setFavorite).toHaveBeenLastCalledWith(4, false))
    await waitFor(() => expect(within(popup()).queryByText('★ お気に入り')).not.toBeInTheDocument())
  })

  it('お気に入りのセクションの項目を選ぶと、従来どおり、その値が選ばれてポップアップが閉じる', async () => {
    const { onChange } = setup({ account: [4] })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })

    // お気に入りのセクションの項目が先頭(ツリーの側の交際費は、その後)
    fireEvent.click(within(popup()).getAllByRole('button', { name: '交際費' })[0])

    expect(onChange).toHaveBeenCalledWith('4')
    expect(screen.queryByRole('dialog', { name: '科目' })).not.toBeInTheDocument()
  })

  it('検索すると、お気に入りも同じ検索語で絞り込む', async () => {
    setup({ account: [1, 4] })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })

    fireEvent.change(within(popup()).getByRole('searchbox', { name: '科目を検索' }), { target: { value: '食' } })

    const list = within(popup())
    expect(list.getAllByRole('button', { name: '食費' }).length).toBeGreaterThan(0)
    expect(list.queryByRole('button', { name: '交際費' })).not.toBeInTheDocument()
  })

  it('★のボタンには、押下状態(aria-pressed)と、追加・解除が分かる名前がある', async () => {
    setup({ account: [1] })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })
    const list = within(popup())

    expect(star(list, '食費', true)[0]).toHaveAttribute('aria-pressed', 'true')
    expect(star(list, '交際費', false)[0]).toHaveAttribute('aria-pressed', 'false')
  })

  it('矢印キーの移動は、★のボタンをたどらず、項目の行だけをたどる(★はTabで届く)', async () => {
    setup({ account: [4] })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })
    const list = within(popup())
    const search = list.getByRole('searchbox', { name: '科目を検索' })
    search.focus()

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(list.getAllByRole('button', { name: '交際費' })[0])
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })

    // 次の移動先は、お気に入りの交際費の★ではなく、次の項目の行
    expect((document.activeElement as HTMLElement).getAttribute('data-favorite-toggle')).toBeNull()
  })

  it('種類(favoriteKind)ごとに、別のお気に入りを見る(取引先の選択欄は、科目のお気に入りを出さない)', async () => {
    setup({ account: [1], counterparty: [4], props: { favoriteKind: 'counterparty' } })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })

    expect(within(popup()).getAllByRole('button', { name: '交際費' })).toHaveLength(2)
    // 科目のお気に入り(食費)は出ない。食費は閉じた「日常」グループの中なので、ツリーにも出ない
    expect(within(popup()).queryByRole('button', { name: '食費' })).not.toBeInTheDocument()
  })

  it('無効な項目は、選択中でなければ、お気に入りでも出さない', async () => {
    const withInactive: TreeSelectCategory[] = [{ key: 'x', name: '費用', nodes: [item(1, '旧費目', false), item(2, '新費目')] }]
    setup({ account: [1, 2], props: { categories: withInactive } })
    await waitFor(async () => {
      fireEvent.click(trigger())
      expect(within(popup()).getByText('★ お気に入り')).toBeInTheDocument()
    })

    expect(within(popup()).queryByText('旧費目')).not.toBeInTheDocument()
    expect(within(popup()).getAllByRole('button', { name: '新費目' })).toHaveLength(2)
  })

  it('プロバイダーが無いときは、favoriteKindを渡しても、★もセクションも出さない(従来の見た目のまま)', async () => {
    setup({ withProvider: false })
    const list = await open()

    expect(list.queryByText('★ お気に入り')).not.toBeInTheDocument()
    expect(list.queryByRole('button', { name: /お気に入り/ })).not.toBeInTheDocument()
  })

  it('favoriteKindを渡さない選択欄は、プロバイダーがあっても、★もセクションも出さない', async () => {
    setup({ account: [1], props: { favoriteKind: undefined } })
    await waitFor(() => expect(trigger()).toBeInTheDocument())
    const list = await open()

    expect(list.queryByText('★ お気に入り')).not.toBeInTheDocument()
    expect(list.queryByRole('button', { name: /お気に入り/ })).not.toBeInTheDocument()
  })
})

describe('TreeSelect: お気に入り(複数選択)', () => {
  it('★のボタンを押しても、選択中の値は変わらず、複数選択のポップアップも閉じない', async () => {
    const account = repository([])
    const onValuesChange = vi.fn()
    render(
      <FavoritesProvider repositories={{ account: account.repo, counterparty: repository([]).repo, project: repository([]).repo }} refreshKey="a">
        <TreeSelect label="科目" categories={categories} multiple values={['1']} onValuesChange={onValuesChange} favoriteKind="account" />
      </FavoritesProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^科目/ }))

    fireEvent.click(screen.getAllByRole('button', { name: '交際費をお気に入りに追加' })[0])

    await waitFor(() => expect(account.setFavorite).toHaveBeenCalledWith(4, true))
    expect(onValuesChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '科目' })).toBeInTheDocument()
  })
})
