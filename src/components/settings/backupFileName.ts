/**
 * バックアップの書き出しファイル名(計画Issue #173)。書き出した日時(ローカル時刻)を分まで入れ、
 * 何回書き出しても前のファイルを上書きしないようにする。フォルダ保存(計画Issue #174)で置く
 * `local-budget.sqlite` と取り違えないよう、`-backup-` を付けて名前を分ける。
 */
export function backupFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`
  return `local-budget-backup-${day}-${time}.sqlite`
}
