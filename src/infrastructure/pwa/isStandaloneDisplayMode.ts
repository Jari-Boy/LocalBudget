/**
 * PWAが既にホーム画面から起動されている(スタンドアロン表示)かどうかを判定する。
 * `navigator.standalone`はiOS Safari固有の非標準プロパティ、
 * `display-mode: standalone`のmedia queryは標準的なPWA起動判定手段であり、
 * 両方をチェックすることでiOS/その他プラットフォームの双方をカバーする。
 */
export function isStandaloneDisplayMode(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches
}
