// @vitest-environment jsdom
/**
 * ImportPager(明細取込画面の一覧のページ送り、計画Issue #263)のコンポーネントテスト。
 * 「1–50 / N件」の範囲表示、ページ番号(いまのページの印・省略)、前へ/次へ(先頭・最終ページで押せない)、
 * 押したページ番号の通知、行が無いときは何も出さないことを確認する。
 * 外部依存はなし(コールバックはvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import { ImportPager } from './ImportPager'

afterEach(cleanup)

function renderPager(total: number, page: number, pageSize = 50) {
  const onPage = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ImportPager total={total} page={page} pageSize={pageSize} onPage={onPage} />
    </I18nextProvider>,
  )
  return { onPage }
}

describe('ImportPager', () => {
  it('いま出している行の範囲と全体の件数を「1–50 / 372件」の形で出す', () => {
    renderPager(372, 1)

    expect(screen.getByText('1–50 / 372件')).toBeInTheDocument()
  })

  it('最終ページでは残りの件数までの範囲を出す', () => {
    renderPager(120, 3)

    expect(screen.getByText('101–120 / 120件')).toBeInTheDocument()
  })

  it('いまのページの番号に aria-current を付け、離れたページは「…」で省く', () => {
    renderPager(400, 1)

    expect(screen.getByRole('button', { name: '1ページ目' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '8ページ目' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('button', { name: '5ページ目' })).not.toBeInTheDocument()
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('番号を押すと、そのページ番号で通知する', () => {
    const { onPage } = renderPager(400, 1)

    fireEvent.click(screen.getByRole('button', { name: '3ページ目' }))

    expect(onPage).toHaveBeenCalledWith(3)
  })

  it('「次へ」「前へ」で隣のページへ移る通知をする', () => {
    const { onPage } = renderPager(400, 4)

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    expect(onPage).toHaveBeenLastCalledWith(5)
    fireEvent.click(screen.getByRole('button', { name: '前のページ' }))
    expect(onPage).toHaveBeenLastCalledWith(3)
  })

  it('先頭ページでは「前へ」、最終ページでは「次へ」が押せない', () => {
    renderPager(100, 1)
    expect(screen.getByRole('button', { name: '前のページ' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '次のページ' })).toBeEnabled()

    cleanup()
    renderPager(100, 2)
    expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled()
  })

  it('1ページに収まるときは、範囲だけを出してページ番号・前へ・次へは出さない', () => {
    renderPager(4, 1)

    expect(screen.getByText('1–4 / 4件')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('行が1件も無いときは、何も出さない', () => {
    const { onPage } = renderPager(0, 1)

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(onPage).not.toHaveBeenCalled()
  })
})
