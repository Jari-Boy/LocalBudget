/**
 * 取込画面の「科目(取込先)」の選択欄(共通の選択欄、計画Issue #234)を操作する、テスト用の補助関数。
 * 欄を開き、検索で絞ってから科目を選ぶ。取込画面のテスト(StatementImportScreen*.test.tsx)で共有する。
 * 外部依存なし(@testing-library/react の screen を使うだけ)。
 */
import { expect } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

/** 取込先の選択欄のボタン(ほかの「科目」を含む名前と区別するため、「科目: 」で始まるものだけ) */
export const findTargetAccountButton = () => screen.findByRole('button', { name: /^科目: / })

/** 取込先の選択欄を開き、検索で絞って、名前の科目を選ぶ */
export async function chooseTargetAccount(name: string) {
  fireEvent.click(await findTargetAccountButton())
  const dialog = within(screen.getByRole('dialog', { name: '科目' }))
  fireEvent.change(dialog.getByRole('searchbox'), { target: { value: name } })
  fireEvent.click(dialog.getByRole('button', { name }))
}

/** 取込先に選ばれている科目の名前を確認する。未選択(null)なら「選択してください」 */
export function expectTargetAccount(name: string | null) {
  expect(screen.getByRole('button', { name: `科目: ${name ?? '選択してください'}` })).toBeInTheDocument()
}
