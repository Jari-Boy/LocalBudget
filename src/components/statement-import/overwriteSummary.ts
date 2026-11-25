import type { ImportRowState } from './importRowModel'

/**
 * キーワードの「N行を上書き」の確認ダイアログに出す、入力済みで書き換わる行の数(計画Issue #291)。
 * 上書きの前後の行の状態(同じ並び)を比べ、書き換わった行のうち、もともと取引先か相手科目が入っていた行だけを数える。
 * 手で選んだ値も消えることを、押す前に伝えるために使う。DB・DOM非依存の純粋関数。
 */
export function countFilledRowsOverwritten(before: readonly ImportRowState[], after: readonly ImportRowState[]): number {
  return before.filter((state, index) => after[index] !== state && (state.counterpartyId !== null || state.counterAccountId !== null)).length
}
