/**
 * uniqueName(計画Issue #154)のテスト。
 * 「新しいプロジェクト」のような既定の名前でマスタ項目を作るとき、既に同じ名前があっても
 * 重複して失敗しないよう、末尾に連番を付けて未使用の名前を返す純粋関数を検証する。
 */
import { describe, expect, it } from 'vitest'
import { uniqueName } from './uniqueName'

describe('uniqueName', () => {
  it('同じ名前が無ければ、そのまま返す', () => {
    expect(uniqueName('新しいプロジェクト', ['旅行'])).toBe('新しいプロジェクト')
  })

  it('同じ名前があれば、末尾に連番を付けて返す', () => {
    expect(uniqueName('新しいプロジェクト', ['新しいプロジェクト'])).toBe('新しいプロジェクト 2')
  })

  it('連番も使われていれば、未使用の番号まで進める', () => {
    expect(uniqueName('新しいプロジェクト', ['新しいプロジェクト', '新しいプロジェクト 2'])).toBe(
      '新しいプロジェクト 3',
    )
  })
})
