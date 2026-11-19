// @vitest-environment jsdom
/**
 * FavoritesProvider・useFavorites(お気に入りの状態の一元管理、計画Issue #231 フェーズ4)のコンポーネントテスト。
 * 科目・取引先・プロジェクトのお気に入りのidを起動時に読み込み、付け外しで画面にすぐ反映して(楽観的更新)Repositoryへ保存すること、
 * 保存に失敗したときは元の状態に戻すこと、refreshKeyが変わったら読み直すこと、プロバイダーが無いときは「お気に入り無し・付け外し不可」に
 * なることを検証する。外部依存なし(Repositoryは差し替えたテスト用の実装)。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoritesProvider, useFavorites, type FavoriteKind, type FavoriteRepository } from './FavoritesContext'

afterEach(cleanup)

function fakeRepository(initial: number[], options: { failSet?: boolean } = {}) {
  let ids = [...initial]
  const findFavoriteIds = vi.fn(async () => [...ids])
  const setFavorite = vi.fn(async (id: number, isFavorite: boolean) => {
    if (options.failSet) throw new Error('保存に失敗')
    ids = isFavorite ? [...ids, id] : ids.filter((x) => x !== id)
  })
  const repository: FavoriteRepository = { findFavoriteIds, setFavorite }
  return { repository, findFavoriteIds, setFavorite }
}

function Probe() {
  const favorites = useFavorites()
  const kinds: FavoriteKind[] = ['account', 'counterparty', 'project']
  return (
    <div>
      {kinds.map((kind) => (
        <div key={kind}>
          <output aria-label={`${kind}のお気に入り`}>{[...favorites.ids[kind]].sort().join(',')}</output>
          <button type="button" onClick={() => void favorites.toggle?.(kind, 1)}>
            {kind}の1を切り替え
          </button>
        </div>
      ))}
      <output aria-label="切り替えできるか">{favorites.toggle === undefined ? 'いいえ' : 'はい'}</output>
    </div>
  )
}

const repositoriesOf = (account: FavoriteRepository, counterparty = fakeRepository([]).repository, project = fakeRepository([]).repository) => ({
  account,
  counterparty,
  project,
})

describe('FavoritesProvider', () => {
  it('起動時に、3つのRepositoryからお気に入りのidを読み込む', async () => {
    render(
      <FavoritesProvider
        repositories={repositoriesOf(fakeRepository([1, 3]).repository, fakeRepository([2]).repository)}
        refreshKey="a"
      >
        <Probe />
      </FavoritesProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent('1,3'))
    expect(screen.getByLabelText('counterpartyのお気に入り')).toHaveTextContent('2')
    expect(screen.getByLabelText('projectのお気に入り')).toHaveTextContent('')
  })

  it('付け外しは、Repositoryへ保存して画面へ反映する(種類ごとに別々)', async () => {
    const account = fakeRepository([])
    render(
      <FavoritesProvider repositories={repositoriesOf(account.repository)} refreshKey="a">
        <Probe />
      </FavoritesProvider>,
    )
    await waitFor(() => expect(account.findFavoriteIds).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'accountの1を切り替え' }))
    await waitFor(() => expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent('1'))
    expect(account.setFavorite).toHaveBeenCalledWith(1, true)
    expect(screen.getByLabelText('counterpartyのお気に入り')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'accountの1を切り替え' }))
    await waitFor(() => expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent(''))
    expect(account.setFavorite).toHaveBeenLastCalledWith(1, false)
  })

  it('保存に失敗したときは、画面の状態を元に戻す', async () => {
    const account = fakeRepository([], { failSet: true })
    render(
      <FavoritesProvider repositories={repositoriesOf(account.repository)} refreshKey="a">
        <Probe />
      </FavoritesProvider>,
    )
    await waitFor(() => expect(account.findFavoriteIds).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'accountの1を切り替え' }))
    })

    await waitFor(() => expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent(''))
    expect(account.setFavorite).toHaveBeenCalledTimes(1)
  })

  it('refreshKeyが変わると、お気に入りを読み直す(統合・削除などで変わった状態に追従する)', async () => {
    const account = fakeRepository([1])
    const repositories = repositoriesOf(account.repository)
    const view = render(
      <FavoritesProvider repositories={repositories} refreshKey="a">
        <Probe />
      </FavoritesProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent('1'))
    expect(account.findFavoriteIds).toHaveBeenCalledTimes(1)

    view.rerender(
      <FavoritesProvider repositories={repositories} refreshKey="b">
        <Probe />
      </FavoritesProvider>,
    )

    await waitFor(() => expect(account.findFavoriteIds).toHaveBeenCalledTimes(2))
  })
})

describe('useFavorites(プロバイダーが無いとき)', () => {
  it('お気に入りは無く、付け外しもできない(既存の画面・テストは、従来どおりの見た目のまま)', () => {
    render(<Probe />)

    expect(screen.getByLabelText('accountのお気に入り')).toHaveTextContent('')
    expect(screen.getByLabelText('切り替えできるか')).toHaveTextContent('いいえ')
  })
})
