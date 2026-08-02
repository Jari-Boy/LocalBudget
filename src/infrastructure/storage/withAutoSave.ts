import type { Database } from 'sql.js'
import type { StorageAdapter } from './StorageAdapter'

/** 最終更新からsave()実行までのデバウンス間隔(ミリ秒)。計画Issue #58で2秒に決定。 */
export const SAVE_DEBOUNCE_MS = 2000

/**
 * withAutoSaveが返す制御用ハンドル。save()の失敗はfire-and-forgetで実行されるため
 * (呼び出し元のRepositoryメソッドは既に同期的に処理を終えている)、直近の保存が
 * 失敗しているかどうかをこのハンドル経由で後から検知できるようにする。
 */
export interface AutoSaveController {
  /**
   * 保留中のデバウンスタイマーを待たず、直ちにsave()を実行する。ページ非表示時等、
   * デバウンス間隔を待てないタイミングでの確実な保存に使う(呼び出し元はメインスレッド
   * 側からRPC越しに呼ぶ想定)。
   */
  flush(): Promise<void>
  /** 直近のsave()呼び出しが失敗していればそのエラー、成功していればnull。 */
  getLastSaveError(): unknown
}

/**
 * db(sql.js Database)のrun()呼び出しを監視し、DBの変更をStorageAdapterへ
 * SAVE_DEBOUNCE_MSのtrailing debounceで永続化する(docs/architecture.md 4.2節
 * 「書き込みはデバウンスし、頻繁な書き込みを避ける」/計画Issue #58)。BEGIN〜COMMIT/
 * ROLLBACKで囲まれた複数のrun()呼び出しは1つの不可分な書き込み単位(docs/guides/patterns.md
 * 「新しいRepositoryメソッドが複数回のDB書き込みを伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK
 * 規約を適用し忘れる」参照)であるため、トランザクション境界(COMMIT/ROLLBACK完了時、または
 * トランザクションを伴わない単発のrun())ごとにデバウンスタイマーをリセットする。
 *
 * db.export()はsetTimeoutのコールバック内で呼ぶため、run()呼び出しの中で同期的には
 * 呼ばれない。db.export()はsql.js内部でSQLiteの`last_insert_rowid()`をリセットする
 * 副作用を持ち(実測で確認済み)、Repositoryのcreate()実装はほぼ全て`this.db.run(INSERT...)`
 * の直後に`last_insert_rowid()`を読んで挿入したレコードを取得するため、run()の同期的な
 * 戻り値の中でexport()を呼ぶと直後のlast_insert_rowid()参照が壊れる。呼び出し元
 * (Repositoryのメソッド)は常に同期的に完結する(sql.jsは同期API)ため、setTimeoutへ
 * 逃がせば呼び出し元の処理が完全に終わった後にのみexport()が実行される。
 *
 * storageAdapter.save()はfire-and-forgetで呼ぶため、失敗(IndexedDBのクォータ超過等)
 * してもunhandled rejectionにせずconsole.errorでログに残し、AutoSaveControllerの
 * getLastSaveError()経由で後から検知できるようにする(UIへの通知配線自体は計画
 * Issue #25のスコープ外)。
 */
export function withAutoSave(db: Database, storageAdapter: StorageAdapter): AutoSaveController {
  let transactionDepth = 0
  let lastSaveError: unknown = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightSave: Promise<void> | null = null
  let pendingRerun: Promise<void> | null = null
  const originalRun = db.run.bind(db)

  db.run = ((...args: Parameters<Database['run']>) => {
    const result = originalRun(...args)

    const normalized = args[0].trim().toUpperCase()
    if (normalized.startsWith('BEGIN')) {
      transactionDepth += 1
    } else if (normalized.startsWith('COMMIT') || normalized.startsWith('ROLLBACK')) {
      transactionDepth = Math.max(0, transactionDepth - 1)
      if (transactionDepth === 0) {
        scheduleSave()
      }
    } else if (transactionDepth === 0) {
      scheduleSave()
    }

    return result
  }) as Database['run']

  function scheduleSave(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void triggerSave()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * storageAdapter.save()の同時多重実行を防ぐ。documentのvisibilitychange(hidden)と
   * windowのpagehideはタブを閉じる操作でほぼ同時に発火しうるため、flushOnPageHide経由で
   * flush()がほぼ同時に2回呼ばれるケース、およびデバウンスタイマーの発火とflush()が
   * 競合するケースがある。保存が既に進行中の間に新たな保存要求が来た場合は、進行中の
   * 保存の完了を待ってから1回だけ改めて保存し直す(複数回要求されても再実行は1回に
   * まとめる)。IndexedDBは同時書き込みを内部で直列化するため実害はないが、将来
   * FileSystemAccessStorageAdapterを配線した場合、同一ファイルへの並行書き込みは
   * 破損やエラーの原因になりうるため、StorageAdapterの実装によらず安全にする。
   */
  function triggerSave(): Promise<void> {
    if (inFlightSave !== null) {
      pendingRerun ??= inFlightSave.then(runOnce)
      return pendingRerun
    }
    return runOnce()
  }

  function runOnce(): Promise<void> {
    pendingRerun = null
    const save = performSave().finally(() => {
      if (inFlightSave === save) {
        inFlightSave = null
      }
    })
    inFlightSave = save
    return save
  }

  function performSave(): Promise<void> {
    return storageAdapter.save(db.export()).then(
      () => {
        lastSaveError = null
      },
      (error: unknown) => {
        lastSaveError = error
        console.error('StorageAdapterへのDB保存に失敗しました', error)
      },
    )
  }

  return {
    flush(): Promise<void> {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      return triggerSave()
    },
    getLastSaveError: () => lastSaveError,
  }
}
