/**
 * iOS「ホーム画面に追加」誘導ポップアップの「今後表示しない」選択状態をlocalStorageへ
 * 永続化する。ユーザーが明示的にこの状態をオンにして閉じない限りfalseのままとなり、
 * 再訪問のたびにポップアップが再表示される(計画Issue #28で確定したUI方針)。
 */
const STORAGE_KEY = 'localbudget:ios-install-prompt-dismissed'

export function isIosInstallPromptDismissed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

export function dismissIosInstallPrompt(): void {
  localStorage.setItem(STORAGE_KEY, 'true')
}
