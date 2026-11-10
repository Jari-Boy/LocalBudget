/**
 * バックアップの書き出しファイル名(backupFileName)のテスト(計画Issue #173)。
 * 書き出した日時(ローカル時刻)を分まで含む `local-budget-backup-YYYYMMDD-HHmm.sqlite` に
 * なること、月日時分が2桁に0埋めされることを検証する。フォルダ保存(計画Issue #174)の
 * `local-budget.sqlite` と取り違えないよう、名前を分けている。
 * 外部依存: なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import { backupFileName } from './backupFileName'

describe('backupFileName', () => {
  it('書き出した日時を分まで含むファイル名にする', () => {
    expect(backupFileName(new Date(2026, 10, 10, 21, 14))).toBe('local-budget-backup-20261110-2114.sqlite')
  })

  it('1桁の月・日・時・分は0埋めして2桁にする', () => {
    expect(backupFileName(new Date(2027, 0, 5, 3, 7))).toBe('local-budget-backup-20270105-0307.sqlite')
  })
})
