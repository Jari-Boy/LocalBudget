/**
 * FileSystemDirectoryHandleに対するreadwrite権限を確認し、必要なら再要求する
 * (docs/architecture.md 4.2節、計画Issue #57 目標1「ディレクトリハンドルはIndexedDBに
 * 保存し次回起動時にqueryPermission/requestPermissionで権限を再確認する」)。
 * queryPermissionが'denied'を返した場合はrequestPermissionを呼んでも意味がないため
 * (MDN: 'denied'状態では以後の操作は全て拒否される)、その場合は再要求せずfalseを返す。
 */
export async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const options = { mode: 'readwrite' } as const

  const currentState = await handle.queryPermission(options)
  if (currentState === 'granted') return true
  if (currentState === 'denied') return false

  return (await handle.requestPermission(options)) === 'granted'
}
