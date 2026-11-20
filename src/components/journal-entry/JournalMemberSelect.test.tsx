// @vitest-environment jsdom
/**
 * JournalMemberSelect(仕訳の起票者・明細行の世帯メンバーを選ぶ欄、計画Issue #234)のコンポーネントテスト。
 * 値が未決定のときの文言、「決めない」項目の名前の指定、科目の既定メンバーを後から変えて旧メンバーのまま残した行の
 * 選択肢(旧メンバーと「(科目の既定)」)、選んだメンバーのid(未決定はnull)での通知を検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { chooseMember, expectMember, listMemberOptions } from '../master/memberSelectTestHelpers'
import { JournalMemberSelect } from './JournalMemberSelect'

afterEach(cleanup)

const member = (id: number, name: string, isActive = true): HouseholdMember => ({
  id,
  name,
  isGroup: false,
  isActive,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})
const members = [member(1, '夫'), member(2, '妻'), member(3, '子', false)]
const props = { label: '世帯メンバー', members }

describe('JournalMemberSelect', () => {
  it('メンバーを選ぶと、そのidで通知する', () => {
    const onChange = vi.fn()
    render(<JournalMemberSelect {...props} memberId={1} onChange={onChange} />)
    chooseMember('世帯メンバー', '妻')
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('メンバーが未決定(null)のときは「選択してください」を出し、選べる', () => {
    const onChange = vi.fn()
    render(<JournalMemberSelect {...props} memberId={null} onChange={onChange} />)
    expectMember('世帯メンバー', '選択してください')
    chooseMember('世帯メンバー', '夫')
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('メンバーが決まっていて、決めない項目の名前も無いときは、未決定に戻す項目を出さない', () => {
    render(<JournalMemberSelect {...props} memberId={1} onChange={vi.fn()} />)
    expect(listMemberOptions('世帯メンバー')).toEqual(['夫', '妻'])
  })

  it('noneLabelを渡すと、その名前の「決めない」項目が常に出て、選ぶとnullで通知する', () => {
    const onChange = vi.fn()
    render(<JournalMemberSelect {...props} memberId={1} noneLabel="起票者と同じ" onChange={onChange} />)
    chooseMember('世帯メンバー', '起票者と同じ')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('無効なメンバーは、現在の値のときだけ残る', () => {
    render(<JournalMemberSelect {...props} memberId={3} onChange={vi.fn()} />)
    expectMember('世帯メンバー', '子')
    expect(listMemberOptions('世帯メンバー')).toContain('子')
  })

  describe('科目の既定メンバーを後から変えて、旧メンバーのまま残した行', () => {
    it('旧メンバーと「(科目の既定)」の2つだけが選べる', () => {
      render(<JournalMemberSelect {...props} memberId={2} defaultMember={members[0]} onChange={vi.fn()} />)
      expect(listMemberOptions('世帯メンバー')).toEqual(['夫(科目の既定)', '妻'])
    })

    it('「(科目の既定)」を選ぶと、既定メンバーのidで通知する', () => {
      const onChange = vi.fn()
      render(<JournalMemberSelect {...props} memberId={2} defaultMember={members[0]} onChange={onChange} />)
      chooseMember('世帯メンバー', '夫(科目の既定)')
      expect(onChange).toHaveBeenCalledWith(1)
    })
  })

  it('disabledのときは、押せない', () => {
    render(<JournalMemberSelect {...props} memberId={1} disabled onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^世帯メンバー/ })).toBeDisabled()
  })
})
