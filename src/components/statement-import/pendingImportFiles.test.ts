/**
 * 仕訳画面の「明細から起票」で選んだCSVを、明細取込画面へ渡す受け渡し口(計画Issue #214)のユニットテスト。
 * ファイルはURLに載せられないため、画面をまたぐ間だけメモリ上に預かり、受け取ったら空にする
 * (1回だけ使える。リロードでは失われ、明細取込画面は「CSVを選択」の開始状態に戻る)ことを検証する。
 * DB非依存、外部依存なし。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setPendingImportFiles, takePendingImportFiles } from './pendingImportFiles'

const file = (name: string) => new File(['x'], name)

beforeEach(() => setPendingImportFiles([]))

describe('pendingImportFiles', () => {
  it('預けたファイルを、預けた順で受け取れる', () => {
    setPendingImportFiles([file('a.csv'), file('b.csv')])

    expect(takePendingImportFiles().map((f) => f.name)).toEqual(['a.csv', 'b.csv'])
  })

  it('受け取ると空になり、続けて受け取っても何も返らない(1回だけ使える)', () => {
    setPendingImportFiles([file('a.csv')])
    takePendingImportFiles()

    expect(takePendingImportFiles()).toEqual([])
  })

  it('何も預けていなければ、空配列が返る', () => {
    expect(takePendingImportFiles()).toEqual([])
  })

  it('もう一度預けると、前に預けたものは置き換わる', () => {
    setPendingImportFiles([file('old.csv')])
    setPendingImportFiles([file('new.csv')])

    expect(takePendingImportFiles().map((f) => f.name)).toEqual(['new.csv'])
  })
})
