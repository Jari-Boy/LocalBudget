/**
 * 仕訳画面の「明細から起票」で選んだCSVを、明細取込画面へ渡す受け渡し口(計画Issue #214)。
 * ファイル(File)はURLに載せられず、ルーターの`state`に載せると履歴に残ってリロードのたびに再読み込みされるため、
 * 画面をまたぐ間だけメモリ上に預かり、受け取ったら空にする(1回だけ使える)。リロードでは失われ、
 * 明細取込画面は「CSVを選択」の開始状態に戻る。
 */
let pending: File[] = []

/** 明細取込画面へ渡すCSVを預ける。前に預けたものは置き換わる */
export function setPendingImportFiles(files: readonly File[]): void {
  pending = [...files]
}

/** 預かったCSVを受け取る。受け取ると空になる */
export function takePendingImportFiles(): File[] {
  const files = pending
  pending = []
  return files
}
