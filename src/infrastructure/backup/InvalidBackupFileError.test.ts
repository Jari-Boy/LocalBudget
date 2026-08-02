/**
 * InvalidBackupFileError のユニットテスト。バックアップファイルのインポート
 * (計画Issue #26)時、アップロードされたバイト列が有効なLocalBudgetのDBとして
 * 扱えない場合(sql.jsが読み込めない、または想定テーブルが揃っていない)にスローされる
 * エラー型で、呼び出し側がinstanceofで判定できることを保証する
 * (docs/decisions.md「エラー型の使い分け基準」参照)。
 * 外部依存: なし。
 */
import { describe, expect, it } from 'vitest'
import { InvalidBackupFileError } from './InvalidBackupFileError'

describe('InvalidBackupFileError', () => {
  it('Errorのサブクラスであり、instanceofで判定できる', () => {
    const error = new InvalidBackupFileError('missing expected tables')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(InvalidBackupFileError)
  })

  it('nameがInvalidBackupFileErrorになる', () => {
    const error = new InvalidBackupFileError('missing expected tables')

    expect(error.name).toBe('InvalidBackupFileError')
  })

  it('渡したmessageをそのまま保持する', () => {
    const error = new InvalidBackupFileError('missing expected tables')

    expect(error.message).toBe('missing expected tables')
  })
})
