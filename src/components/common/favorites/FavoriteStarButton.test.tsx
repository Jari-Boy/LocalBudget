// @vitest-environment jsdom
/**
 * FavoriteStarButton(マスタ画面の行に置く、お気に入りの★のボタン、計画Issue #231 フェーズ4)のコンポーネントテスト。
 * 押下状態(aria-pressed)と、追加・解除が分かる名前を持つこと、押すとお気に入りを付け外しして保存すること、
 * お気に入りの状態をプロバイダーから読むこと、プロバイダーが無いとき(既存の画面・テスト)は何も出さないことを検証する。
 * 外部依存なし(Repositoryは差し替えたテスト用の実装)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteStarButton } from './FavoriteStarButton'
import { FavoritesProvider, type FavoriteRepository } from './FavoritesContext'

afterEach(cleanup)

function repository(initial: number[]) {
  let ids = [...initial]
  const setFavorite = vi.fn(async (id: number, isFavorite: boolean) => {
    ids = isFavorite ? [...ids, id] : ids.filter((x) => x !== id)
  })
  const repo: FavoriteRepository = { findFavoriteIds: async () => [...ids], setFavorite }
  return { repo, setFavorite }
}

function setup(account: number[]) {
  const accountRepo = repository(account)
  render(
    <FavoritesProvider repositories={{ account: accountRepo.repo, counterparty: repository([]).repo, project: repository([]).repo }} refreshKey="a">
      <FavoriteStarButton kind="account" id={1} name="食費" />
    </FavoritesProvider>,
  )
  return accountRepo
}

describe('FavoriteStarButton', () => {
  it('お気に入りでないときは「お気に入りに追加」、お気に入りのときは「お気に入りから外す」の名前と、押下状態を持つ', async () => {
    setup([])
    const off = await screen.findByRole('button', { name: '食費をお気に入りに追加' })
    expect(off).toHaveAttribute('aria-pressed', 'false')
    cleanup()

    setup([1])
    expect(await screen.findByRole('button', { name: '食費をお気に入りから外す' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('押すと、お気に入りを付け外しして保存し、ボタンの状態も変わる', async () => {
    const { setFavorite } = setup([])

    fireEvent.click(await screen.findByRole('button', { name: '食費をお気に入りに追加' }))

    await waitFor(() => expect(setFavorite).toHaveBeenCalledWith(1, true))
    expect(await screen.findByRole('button', { name: '食費をお気に入りから外す' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '食費をお気に入りから外す' }))
    await waitFor(() => expect(setFavorite).toHaveBeenLastCalledWith(1, false))
  })

  it('プロバイダーが無いときは、何も出さない', () => {
    render(<FavoriteStarButton kind="account" id={1} name="食費" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
