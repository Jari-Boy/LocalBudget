import type { Database } from 'sql.js'
import type { StorageAdapter } from './StorageAdapter'

/**
 * db(sql.js Database)のrun()呼び出しを監視し、DBの変更をStorageAdapterへ即時
 * (デバウンスなしの単純なsave呼び出し。書き込みのデバウンスは計画Issue #58で扱う)
 * 永続化する。BEGIN〜COMMIT/ROLLBACKで囲まれた複数のrun()呼び出しは1つの不可分な
 * 書き込み単位(docs/guides/patterns.md「新しいRepositoryメソッドが複数回のDB書き込み
 * を伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK規約を適用し忘れる」参照)であるため、
 * トランザクションの途中で保存すると、クラッシュ時に不完全な状態(例: 仕訳ヘッダーのみ
 * 保存され明細が保存されていない)がStorageAdapter側に残りうる。そのためトランザクション
 * 境界(COMMIT/ROLLBACK完了時、またはトランザクションを伴わない単発のrun())ごとに
 * 1回だけsave()を呼ぶ。
 *
 * db.export()はqueueMicrotaskで遅延実行し、run()呼び出しの中で同期的には呼ばない。
 * db.export()はsql.js内部でSQLiteの`last_insert_rowid()`をリセットする副作用を持ち
 * (実測で確認済み)、Repositoryのcreate()実装はほぼ全て`this.db.run(INSERT...)`の直後に
 * `last_insert_rowid()`を読んで挿入したレコードを取得するため、run()の同期的な戻り値の
 * 中でexport()を呼ぶと直後のlast_insert_rowid()参照が壊れる。呼び出し元(Repositoryの
 * メソッド)は常に同期的に完結する(sql.jsは同期API)ため、マイクロタスクへ逃がせば
 * export()は呼び出し元の処理が完全に終わった後にのみ実行される。
 */
export function withAutoSave(db: Database, storageAdapter: StorageAdapter): void {
  let transactionDepth = 0
  const originalRun = db.run.bind(db)

  db.run = ((...args: Parameters<Database['run']>) => {
    const result = originalRun(...args)

    const normalized = args[0].trim().toUpperCase()
    if (normalized.startsWith('BEGIN')) {
      transactionDepth += 1
    } else if (normalized.startsWith('COMMIT') || normalized.startsWith('ROLLBACK')) {
      transactionDepth = Math.max(0, transactionDepth - 1)
      if (transactionDepth === 0) {
        scheduleSave(db, storageAdapter)
      }
    } else if (transactionDepth === 0) {
      scheduleSave(db, storageAdapter)
    }

    return result
  }) as Database['run']
}

function scheduleSave(db: Database, storageAdapter: StorageAdapter): void {
  queueMicrotask(() => {
    void storageAdapter.save(db.export())
  })
}
