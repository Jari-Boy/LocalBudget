/**
 * runInHistoryGroup(バッチ操作を操作履歴上1件にまとめる補助、計画Issue #202)の単体テスト。
 * 外部依存なし(履歴APIはスタブ)。beginGroup〜endGroupで関数を囲むこと、成功・失敗のどちらでも
 * endGroupが呼ばれること、関数の結果・例外がそのまま呼び出し元へ伝わること、履歴APIが無い場合
 * (テスト等)は何もせず関数だけ実行することを検証する。
 */
import { describe, expect, it } from 'vitest'
import { runInHistoryGroup } from './historyGroupRunner'

function createStub() {
  const calls: string[] = []
  return {
    calls,
    api: {
      beginGroup: async (label: string) => {
        calls.push(`begin:${label}`)
      },
      endGroup: async () => {
        calls.push('end')
      },
    },
  }
}

describe('runInHistoryGroup', () => {
  it('関数をbeginGroup〜endGroupで囲み、結果をそのまま返す', async () => {
    const { calls, api } = createStub()

    const result = await runInHistoryGroup(api, 'statementImport.confirm', async () => {
      calls.push('body')
      return 42
    })

    expect(result).toBe(42)
    expect(calls).toEqual(['begin:statementImport.confirm', 'body', 'end'])
  })

  it('関数が失敗してもendGroupを呼び、例外をそのまま投げる', async () => {
    const { calls, api } = createStub()

    await expect(
      runInHistoryGroup(api, 'x', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(calls).toEqual(['begin:x', 'end'])
  })

  it('履歴APIが無ければ関数だけ実行する', async () => {
    expect(await runInHistoryGroup(undefined, 'x', async () => 'ok')).toBe('ok')
  })

  it('メタ情報の取得関数を渡すと、関数の実行後に取得した値をendGroupへ渡す(計画Issue #295)', async () => {
    const received: unknown[] = []
    const api = {
      beginGroup: async () => {},
      endGroup: async (meta?: unknown) => {
        received.push(meta)
      },
    }
    let meta: { kind: 'statementImport'; institution: string | null; targetAccountName: string; files: [] } | undefined

    await runInHistoryGroup(
      api,
      'statementImport.confirm',
      async () => {
        meta = { kind: 'statementImport', institution: '楽天カード', targetAccountName: '楽天カード(未払金)', files: [] }
      },
      () => meta,
    )

    expect(received).toEqual([{ kind: 'statementImport', institution: '楽天カード', targetAccountName: '楽天カード(未払金)', files: [] }])
  })

  it('メタ情報の取得関数を渡さなければ、endGroupにはメタ情報が渡らない', async () => {
    const received: unknown[] = []
    const api = {
      beginGroup: async () => {},
      endGroup: async (meta?: unknown) => {
        received.push(meta)
      },
    }

    await runInHistoryGroup(api, 'x', async () => 1)

    expect(received).toEqual([undefined])
  })
})
