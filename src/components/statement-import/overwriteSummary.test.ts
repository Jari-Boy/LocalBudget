/**
 * countFilledRowsOverwritten(キーワードの「N行を上書き」の確認に出す、入力済みで書き換わる行数。計画Issue #291)の単体テスト。
 * 上書きの前後の行の状態を比べ、書き換わった行のうち、もともと取引先か相手科目が入っていた行だけを数えることを確認する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { createInitialRowState, type ImportRowState } from './importRowModel'
import { countFilledRowsOverwritten } from './overwriteSummary'

const state = (overrides: Partial<ImportRowState> = {}): ImportRowState => ({
  ...createInitialRowState({ counterpartyId: null, counterAccountId: null, candidateCounterpartyIds: [] }),
  ...overrides,
})

describe('countFilledRowsOverwritten', () => {
  it('書き換わった行のうち、もともと取引先か相手科目が入っていた行だけを数える', () => {
    const before = [state(), state({ counterAccountId: 1 }), state({ counterpartyId: 5 }), state({ counterAccountId: 1, counterpartyId: 5 })]
    const after = before.map((s) => ({ ...s, counterAccountId: 9 }))

    expect(countFilledRowsOverwritten(before, after)).toBe(3)
  })

  it('書き換わっていない行(同じ参照)は、入力済みでも数えない', () => {
    const filled = state({ counterAccountId: 1 })

    expect(countFilledRowsOverwritten([filled], [filled])).toBe(0)
  })

  it('未入力の行だけが書き換わるときは0', () => {
    const before = [state(), state()]
    const after = before.map((s) => ({ ...s, counterAccountId: 9 }))

    expect(countFilledRowsOverwritten(before, after)).toBe(0)
  })
})
