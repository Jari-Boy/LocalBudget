/**
 * 未保存の変更の警告を「出す / 出さない」の設定(計画Issue #190)。移動の種類(行・タブ・画面・
 * リロード)による出し分けはせず、この1つだけで全ての警告を切り替える。選んだ値はlocalStorageに
 * 保存し、再訪時に復元する(このブラウザだけの設定で、バックアップには含めない)。
 * 初期値は「出す」。localStorageが使えない環境や不正な値でも「出す」に倒れ、画面は壊れない。
 */
const STORAGE_KEY = 'localbudget:unsaved-warning'

export function loadUnsavedWarningEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveUnsavedWarningEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // 保存できなくても切替自体は動く(次回は「出す」に戻る)
  }
}
