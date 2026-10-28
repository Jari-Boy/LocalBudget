// @vitest-environment jsdom
/**
 * 行内操作ボタン(編集・削除・非アクティブ化)用の共通アイコン(計画Issue #127)。
 * 装飾用途のみでボタン側のaria-labelが意味を担うため、各アイコンがaria-hidden="true"の
 * <svg>としてレンダリングされることのみを検証する(見た目の確認はブラウザでの実機確認で行う)。
 * 外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChevronDownIcon, EditIcon, EyeIcon, EyeOffIcon, TrashIcon } from './ActionIcons'

afterEach(cleanup)

describe('ActionIcons', () => {
  it.each([
    ['EditIcon', EditIcon],
    ['TrashIcon', TrashIcon],
    ['EyeIcon', EyeIcon],
    ['EyeOffIcon', EyeOffIcon],
    ['ChevronDownIcon', ChevronDownIcon],
  ])('%sはaria-hidden="true"のsvgとしてレンダリングされる', (_name, Icon) => {
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})
