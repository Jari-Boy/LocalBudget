/** flushOnPageHideが要求する永続化ハンドルの最小インターフェース。 */
export interface FlushablePersistence {
  flush(): Promise<void>
}

/** document相当のvisibilitychange監視に必要な最小インターフェース。 */
export interface VisibilitySource extends EventTarget {
  visibilityState: DocumentVisibilityState
}

/**
 * ページ非表示時(docs/architecture.md 4.2節、計画Issue #58)に、withAutoSaveの
 * デバウンスタイマーを待たず確実に保存されるよう、documentのvisibilitychange
 * (visibilityStateがhiddenになった時)とwindowのpagehideを監視し、persistence.flush()
 * を呼び出す。両イベントとも実際のタブ閉じ/切り替えで発火しうるため両方購読する
 * (docsで検討したvisibilitychangeのみでは実際のアンロード時に発火しないブラウザが
 * あるため、pagehideを保険として併用する)。
 *
 * flush()はfire-and-forgetで呼ぶ(イベントハンドラはPromiseを返せないため)。失敗しても
 * unhandled rejectionにせずconsole.errorでログに残す(withAutoSave.performSaveの
 * エラーハンドリング方針と同様)。
 *
 * documentSource/windowSourceはEventTargetの標準APIのみに依存する引数として受け取り、
 * 実際のdocument/windowだけでなくNode組み込みのEventTargetでもテストできるようにする
 * (waitForWorkerReadyと同様の設計)。
 */
export function flushOnPageHide(
  persistence: FlushablePersistence,
  documentSource: VisibilitySource,
  windowSource: EventTarget,
): void {
  function flush(): void {
    persistence.flush().catch((error: unknown) => {
      console.error('ページ非表示時のflush()に失敗しました', error)
    })
  }

  documentSource.addEventListener('visibilitychange', () => {
    if (documentSource.visibilityState === 'hidden') {
      flush()
    }
  })
  windowSource.addEventListener('pagehide', flush)
}
