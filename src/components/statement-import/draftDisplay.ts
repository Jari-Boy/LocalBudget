/**
 * 明細取込の一時保存の表示用の純粋関数(計画Issue #231 フェーズ3)。DB・DOM非依存。
 */

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * DBに持つ保存日時(UTCの 'YYYY-MM-DD HH:MM:SS')を、利用者の端末の時刻の 'YYYY/MM/DD HH:mm' にする。
 * 読めない文字列は、そのまま返す。
 */
export function formatDraftSavedAt(updatedAt: string): string {
  const date = new Date(`${updatedAt.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return updatedAt
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
