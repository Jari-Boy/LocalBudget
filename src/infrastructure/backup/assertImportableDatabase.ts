import type { Database } from 'sql.js'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
import { assertValidDatabaseSchema } from './assertValidDatabaseSchema'
import { InvalidBackupFileError } from './InvalidBackupFileError'

/**
 * DBのバイト列がLocalBudgetのDBとして取り込めるかを、使い捨てのDBで検証する。
 * バックアップの読み込み(計画Issue #26)と、フォルダの既存ファイルを開く操作(計画Issue #174)で
 * 共通。assertValidDatabaseSchemaは必ずrunMigrationsより先に実行する(理由は
 * importDatabaseBackupのコメントを参照)。取り込めなければInvalidBackupFileErrorを投げ、
 * 呼び出し元の保存先には一切触れない。
 */
export async function assertImportableDatabase(data: Uint8Array): Promise<void> {
  let scratchDb: Database | undefined
  try {
    scratchDb = await createBrowserDatabase(data)
    assertValidDatabaseSchema(scratchDb)
    runMigrations(scratchDb)
  } catch (error) {
    if (error instanceof InvalidBackupFileError) {
      throw error
    }
    throw new InvalidBackupFileError(`invalid backup file: ${String(error)}`)
  } finally {
    scratchDb?.close()
  }
}
