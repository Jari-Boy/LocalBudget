/** importNoticeが使うStorageの最小インターフェース(テストで偽物を渡せるようにする)。 */
export type NoticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const NOTICE_KEY = 'local-budget:import-notice'

/**
 * 本番で使うsessionStorage。`window.sessionStorage`の参照自体が例外を投げる環境があるため、
 * 参照はメソッドの中で行い、下の関数のtry/catchで受け止める。
 */
export const sessionNoticeStorage: NoticeStorage = {
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
  removeItem: (key) => window.sessionStorage.removeItem(key),
}

/**
 * バックアップ読み込み後のお知らせの印(計画Issue #173)。読み込みが終わるとページを再読み込みして
 * Workerに新しいDBを読み直させるため、画面の状態は消える。再読み込みの前にsessionStorageへ
 * 読み込んだファイル名を残し、再読み込み後の設定画面が1回だけ取り出して「読み込みました」と出す。
 * sessionStorageはプライベートウィンドウ等で例外を投げうるため、失敗してもお知らせを出さない
 * だけにして、読み込みそのものや画面の表示は止めない。
 */
export function markImportCompleted(fileName: string, storage: NoticeStorage): void {
  try {
    storage.setItem(NOTICE_KEY, fileName)
  } catch {
    // お知らせが出ないだけなので無視する
  }
}

/** 残された印を取り出して消す。印がない、またはストレージが使えなければnull。 */
export function takeImportNotice(storage: NoticeStorage): string | null {
  try {
    const fileName = storage.getItem(NOTICE_KEY)
    if (fileName !== null) storage.removeItem(NOTICE_KEY)
    return fileName
  } catch {
    return null
  }
}
