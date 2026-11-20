/**
 * 精算バッチの選択欄(BatchSelect、計画Issue #234)を操作する、テスト用の補助関数。
 * 欄のボタンの探し方・開き方・選び方は世帯メンバーの選択欄と同じなので、memberSelectTestHelpers の関数を
 * バッチ用の名前で出し直す。仕訳の明細行・一括編集・割勘タブ・取り込みのテストで共有する。外部依存なし。
 */
import { screen, type BoundFunctions, type queries } from '@testing-library/react'
import { chooseMember, chooseMemberFrom, expectMember, findMemberButton, listMemberOptions } from './memberSelectTestHelpers'

type Scope = BoundFunctions<typeof queries>

/** 欄のボタンを1つ探す(無ければ例外) */
export const findBatchButton = findMemberButton

/** 欄のボタンがあれば返し、無ければnullを返す。「欄が出ない」ことの確認に使う */
export const queryBatchButton = (label: string, scope: Scope = screen): HTMLElement | null =>
  scope.queryByRole('button', { name: (name) => name === label || name.startsWith(`${label}: `) })

/** 欄を開き、名前の項目(バッチ・「精算バッチなし」「変更しない」などの特別な項目)を選ぶ */
export const chooseBatch = chooseMember

/** 渡したボタンの欄を開き、名前の項目を選ぶ。同じ名前の欄が画面に複数あるとき(割勘タブの絞り込みの「精算バッチ」など)に使う */
export const chooseBatchFrom = chooseMemberFrom

/** 欄のボタンに出ている現在の値を確認する */
export const expectBatch = expectMember

/** 欄を開き、候補の名前の一覧を返す */
export const listBatchOptions = listMemberOptions
