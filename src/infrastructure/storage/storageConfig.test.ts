/**
 * parseStorageConfig のユニットテスト(計画Issue #174)。IndexedDBに保存した「データの保存先」の
 * 選択(ブラウザ内/フォルダ)を読み戻すとき、未保存・壊れた値は既定のブラウザ内にそろえる
 * (読めない値でフォルダ保存の再接続画面に迷い込ませない)。
 * 外部依存: なし(IndexedDBへの読み書き自体はE2Eで検証する)。
 */
import { describe, expect, it } from 'vitest'
import { parseStorageConfig } from './storageConfig'

describe('parseStorageConfig', () => {
  it('未保存(null)ならブラウザ内を返す', () => {
    expect(parseStorageConfig(null)).toEqual({ kind: 'indexeddb' })
  })

  it('kindがfolderならフォルダを返す', () => {
    expect(parseStorageConfig({ kind: 'folder' })).toEqual({ kind: 'folder' })
  })

  it('kindがindexeddbならブラウザ内を返す', () => {
    expect(parseStorageConfig({ kind: 'indexeddb' })).toEqual({ kind: 'indexeddb' })
  })

  it('知らないkindや形の違う値はブラウザ内にそろえる', () => {
    expect(parseStorageConfig({ kind: 'cloud' })).toEqual({ kind: 'indexeddb' })
    expect(parseStorageConfig('folder')).toEqual({ kind: 'indexeddb' })
    expect(parseStorageConfig(42)).toEqual({ kind: 'indexeddb' })
  })
})
