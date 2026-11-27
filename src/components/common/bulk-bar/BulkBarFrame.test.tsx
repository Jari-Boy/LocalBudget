// @vitest-environment jsdom
/**
 * BulkBarFrame / BulkBarField(一括編集バーの見た目の骨格。計画Issue #300)のコンポーネントテスト。
 * 外部依存なし(DB・ストレージ・ネットワークを使わない)。
 * 検証対象: 1段目(件数などの概要・選択解除・適用)、2段目(ラベル付き項目の並び)、
 * 項目の下の理由の欄(理由が無いときも場所を空ける)。項目の中身とルール判定は呼び出し側の責務なのでここでは扱わない。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BulkBarField, BulkBarFrame } from './BulkBarFrame'

afterEach(cleanup)

function renderFrame(overrides: Partial<React.ComponentProps<typeof BulkBarFrame>> = {}) {
  const props = {
    ariaLabel: '一括編集',
    summary: <strong>3行を選択中</strong>,
    onClearSelection: vi.fn(),
    applyLabel: '3行に適用',
    applyDisabled: false,
    onApply: vi.fn(),
    columns: 5 as const,
    ...overrides,
  }
  render(
    <BulkBarFrame {...props}>
      <BulkBarField label="科目">
        <select aria-label="科目の選択">
          <option>変更しない</option>
        </select>
      </BulkBarField>
      <BulkBarField label="取引先" reason="費用・収益の行のみ">
        <select aria-label="取引先の選択" disabled>
          <option>変更しない</option>
        </select>
      </BulkBarField>
    </BulkBarFrame>,
  )
  return props
}

describe('BulkBarFrame', () => {
  it('指定した名前の領域として、1段目に概要・選択解除・適用を出す', () => {
    renderFrame()
    const bar = screen.getByRole('region', { name: '一括編集' })
    expect(within(bar).getByText('3行を選択中')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: '選択を解除' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: '3行に適用' })).toBeInTheDocument()
  })

  it('選択を解除・適用のボタンが、それぞれ呼び出し側の関数を呼ぶ', () => {
    const props = renderFrame()
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }))
    fireEvent.click(screen.getByRole('button', { name: '3行に適用' }))
    expect(props.onClearSelection).toHaveBeenCalledTimes(1)
    expect(props.onApply).toHaveBeenCalledTimes(1)
  })

  it('applyDisabled のとき、適用を押せない', () => {
    const props = renderFrame({ applyDisabled: true, applyLabel: '適用' })
    const apply = screen.getByRole('button', { name: '適用' })
    expect(apply).toBeDisabled()
    fireEvent.click(apply)
    expect(props.onApply).not.toHaveBeenCalled()
  })

  it('role を渡すと、その役割の領域になる(取込画面は group のまま)', () => {
    renderFrame({ role: 'group', ariaLabel: '選択した明細への一括設定' })
    expect(screen.getByRole('group', { name: '選択した明細への一括設定' })).toBeInTheDocument()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('項目の数(columns)を、2段目の列数として持つ', () => {
    renderFrame({ columns: 6 })
    expect(screen.getByRole('region').querySelector('.bulk-bar__fields')).toHaveClass('bulk-bar__fields--6')
  })
})

describe('BulkBarField', () => {
  it('ラベルと選択欄を、1つの項目として並べる', () => {
    renderFrame()
    const field = screen.getByText('科目', { selector: '.bulk-bar__label' }).closest('.bulk-bar__field') as HTMLElement
    expect(within(field).getByRole('combobox', { name: '科目の選択' })).toBeInTheDocument()
  })

  it('理由を渡すと項目の下に出し、渡さなくても理由の欄(場所)は残す', () => {
    renderFrame()
    const withReason = screen.getByText('取引先', { selector: '.bulk-bar__label' }).closest('.bulk-bar__field') as HTMLElement
    expect(within(withReason).getByText('費用・収益の行のみ')).toBeInTheDocument()
    const without = screen.getByText('科目', { selector: '.bulk-bar__label' }).closest('.bulk-bar__field') as HTMLElement
    const why = without.querySelector('.bulk-bar__why')
    expect(why).not.toBeNull()
    expect(why).toHaveTextContent('')
  })
})
