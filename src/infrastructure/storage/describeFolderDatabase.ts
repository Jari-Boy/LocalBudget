export const DATABASE_FILE_NAME = 'local-budget.sqlite'

export interface FolderDatabaseInfo {
  size: number
  lastModified: number
}

/**
 * 選んだフォルダに既存のDBファイルがあるか調べる(計画Issue #174)。あれば「開く/上書き」の
 * 選択ダイアログに出すサイズと更新日時を返し、無ければnullを返す。
 */
export async function describeFolderDatabase(
  folder: FileSystemDirectoryHandle,
): Promise<FolderDatabaseInfo | null> {
  try {
    const file = await (await folder.getFileHandle(DATABASE_FILE_NAME)).getFile()
    return { size: file.size, lastModified: file.lastModified }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}
