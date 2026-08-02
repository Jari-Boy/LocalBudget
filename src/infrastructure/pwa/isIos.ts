/**
 * User-Agent文字列からiOSデバイス(iPhone/iPad/iPod)かどうかを判定する。
 * iOS上のブラウザは(Safari以外の代替ブラウザも含め)`beforeinstallprompt`に
 * 対応しないため、「ホーム画面に追加」誘導ポップアップの表示要否判定に使う。
 */
export function isIos(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent)
}
