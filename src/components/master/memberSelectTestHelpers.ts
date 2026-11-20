/**
 * 世帯メンバーの選択欄(MemberSelect、計画Issue #234)を操作する、テスト用の補助関数。
 * 欄のボタンを押してポップアップを開き、メンバーの名前(または先頭の特別な項目の文言)を選ぶ。
 * 名義・起票者・仕訳の明細行など、メンバーを選ぶ画面のテストで共有する。外部依存なし(@testing-library/react の screen を使うだけ)。
 */
import { expect } from 'vitest'
import { fireEvent, screen, within, type BoundFunctions, type queries } from '@testing-library/react'

type Scope = BoundFunctions<typeof queries>

/** 欄のボタン。aria-labelは「ラベル: 現在の値」。ラベルが同じで値だけ違うものを区別しないよう、「ラベル: 」で始まるものを探す */
const labelMatcher = (label: string) => (name: string) => name === label || name.startsWith(`${label}: `)

/** 欄のボタンを探す。scopeを渡すと、その範囲(パネル・行など)の中だけを探す */
export const findMemberButton = (label: string, scope: Scope = screen) => scope.getByRole('button', { name: labelMatcher(label) })

/** 欄を開き、名前の項目(メンバー・「全員」「なし」などの特別な項目)を選ぶ */
export function chooseMember(label: string, name: string, scope: Scope = screen) {
  fireEvent.click(findMemberButton(label, scope))
  const dialog = within(screen.getByRole('dialog', { name: label }))
  fireEvent.click(dialog.getByRole('button', { name }))
}

/** 欄のボタンに出ている現在の値(メンバーの名前、または未選択の文言)を確認する */
export function expectMember(label: string, name: string, scope: Scope = screen) {
  expect(findMemberButton(label, scope)).toHaveAccessibleName(`${label}: ${name}`)
}

/** 欄を開き、候補(ポップアップ内のボタン)の名前の一覧を返す。確認のあと、欄は開いたままにせず閉じる */
export function listMemberOptions(label: string, scope: Scope = screen): string[] {
  fireEvent.click(findMemberButton(label, scope))
  const dialog = within(screen.getByRole('dialog', { name: label }))
  const names = dialog.getAllByRole('button').map((b) => b.textContent ?? '')
  fireEvent.keyDown(screen.getByRole('dialog', { name: label }), { key: 'Escape' })
  return names
}
