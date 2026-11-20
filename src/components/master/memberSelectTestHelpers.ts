/**
 * 世帯メンバーの選択欄(MemberSelect、計画Issue #234)を操作する、テスト用の補助関数。
 * 欄のボタンを押してポップアップを開き、メンバーの名前(または先頭の特別な項目の文言)を選ぶ。
 * 名義・起票者・仕訳の明細行など、メンバーを選ぶ画面のテストで共有する。外部依存なし(@testing-library/react の screen を使うだけ)。
 * 同じ名前の欄が複数ある画面(仕訳の明細行など)は、findMemberButtonsで全部のボタンを取り、1つずつ渡す。
 */
import { expect } from 'vitest'
import { fireEvent, screen, within, type BoundFunctions, type queries } from '@testing-library/react'

type Scope = BoundFunctions<typeof queries>

/** 欄のボタン。aria-labelは「ラベル: 現在の値」。値だけ違う欄を区別しないよう、「ラベル: 」で始まるものを探す */
const labelMatcher = (label: string) => (name: string) => name === label || name.startsWith(`${label}: `)

/** 欄のボタンを1つ探す。scopeを渡すと、その範囲(パネル・列・行など)の中だけを探す */
export const findMemberButton = (label: string, scope: Scope = screen) => scope.getByRole('button', { name: labelMatcher(label) })

/** 同じ名前の欄のボタンを、画面の上から順に全部探す(仕訳の明細行ごとの欄など) */
export const findMemberButtons = (label: string, scope: Scope = screen) => scope.getAllByRole('button', { name: labelMatcher(label) })

/** ボタンのaria-label(「ラベル: 現在の値」)から、ラベルと現在の値を取り出す */
function splitButtonLabel(button: HTMLElement): { label: string; value: string } {
  const text = button.getAttribute('aria-label') ?? ''
  const at = text.indexOf(': ')
  return at < 0 ? { label: text, value: '' } : { label: text.slice(0, at), value: text.slice(at + 2) }
}

/** ボタンに出ている現在の値(メンバーの名前、または未選択の文言) */
export const memberButtonValue = (button: HTMLElement): string => splitButtonLabel(button).value

/** 渡したボタンの欄を開き、名前の項目(メンバー・「全員」「なし」などの特別な項目)を選ぶ */
export function chooseMemberFrom(button: HTMLElement, name: string) {
  fireEvent.click(button)
  const dialog = within(screen.getByRole('dialog', { name: splitButtonLabel(button).label }))
  fireEvent.click(dialog.getByRole('button', { name }))
}

/** 渡したボタンの欄を開き、候補(ポップアップ内のボタン)の名前の一覧を返し、欄を閉じる */
export function listMemberOptionsOf(button: HTMLElement): string[] {
  fireEvent.click(button)
  const popup = screen.getByRole('dialog', { name: splitButtonLabel(button).label })
  const names = within(popup).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
  fireEvent.keyDown(popup, { key: 'Escape' })
  return names
}

/** 欄を開き、名前の項目を選ぶ */
export const chooseMember = (label: string, name: string, scope: Scope = screen) => chooseMemberFrom(findMemberButton(label, scope), name)

/** 欄を開き、候補の名前の一覧を返す */
export const listMemberOptions = (label: string, scope: Scope = screen) => listMemberOptionsOf(findMemberButton(label, scope))

/** 欄のボタンに出ている現在の値を確認する */
export function expectMember(label: string, name: string, scope: Scope = screen) {
  expect(memberButtonValue(findMemberButton(label, scope))).toBe(name)
}

/** 同じ名前の欄すべての現在の値を、上から順に確認する */
export function expectMembers(label: string, names: string[], scope: Scope = screen) {
  expect(findMemberButtons(label, scope).map(memberButtonValue)).toEqual(names)
}
