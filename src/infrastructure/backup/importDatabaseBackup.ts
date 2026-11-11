import type { StorageAdapter } from '../storage/StorageAdapter'
import type { AutoSaveController } from '../storage/withAutoSave'
import { assertImportableDatabase } from './assertImportableDatabase'

/**
 * アップロードされたDBバイト列を検証し、有効な場合のみStorageAdapterへ永続化する
 * (計画Issue #26で確定した方式: 検証→保存→呼び出し元によるページリロード、
 * docs/architecture.md 8章)。検証は使い捨ての一時Databaseインスタンス上で行うため、
 * 失敗時はStorageAdapterへの書き込みを一切行わず、既存データを破壊しない。
 * Web Worker内で生きているRepository群が保持するDatabaseインスタンス自体は
 * 一切差し替えない(呼び出し元がこの後ページをリロードし、既存の起動フロー
 * (db.worker.tsのmain())がStorageAdapterから読み込み直すことでDBを反映する)。
 *
 * assertValidDatabaseSchemaは必ずrunMigrationsより先に実行する。runMigrationsは
 * PRAGMA user_versionが0の(未マイグレーションの)DBに対してLocalBudgetの全テーブルを
 * 新規作成してしまうため、先にrunMigrationsを適用すると、空のsql.js DBファイルや
 * LocalBudgetと無関係なテーブルしか持たないファイルであっても、検証時点では既に
 * 全テーブルが存在する状態になってしまい、assertValidDatabaseSchemaが常に通過して
 * しまう(evaluatorレビューで指摘された不備、e2e/backup-export-import.spec.tsに
 * 回帰テストあり)。先に生のインポートバイト列そのものの構造を検証し、LocalBudgetの
 * DBだと確認できてから初めてrunMigrations(古いバージョンのバックアップの互換性確認)を
 * 適用する。
 *
 * 保存直前にautoSaveController.flush()を呼ぶのは、直前の編集操作に由来する
 * withAutoSaveの保留中デバウンスタイマー(インポートするバイト列とは無関係な、
 * 生きたdbの現在の状態を書き込もうとするタイマー)が、このインポートの保存より
 * 後に発火して上書きしてしまうのを防ぐため(実装時に発見した競合)。flush()は
 * 保留中のタイマーを解消して即座に保存を確定させるため、以後は本関数が保存する
 * バイト列が最後の書き込みになることが保証される。flush()の後はautoSaveController.stop()で
 * 自動保存を止める(計画Issue #173)。止めないと、呼び出し元がこの後ページを再読み込みする際の
 * pagehide/visibilitychangeでflush()が呼ばれ、Worker内に残る古いDBの状態がインポートした
 * バイト列を上書きしてしまう。flush()を先に呼ぶのは、インポートの保存自体が失敗した場合でも
 * 直前までの編集がStorageAdapterに残るようにするため。
 *
 * ブラウザのWASM読み込みに依存するcreateBrowserDatabaseを使うため、実ブラウザでの動作は
 * Playwrightで検証する(docs/architecture.md 10章)。検証・flush・stop・saveの呼び出しの有無と順序は、
 * createBrowserDatabaseをNode版のsql.jsに差し替えたimportDatabaseBackup.test.tsで検証する(計画Issue #173)。
 */
export async function importDatabaseBackup(
  data: Uint8Array,
  storageAdapter: StorageAdapter,
  autoSaveController: AutoSaveController,
): Promise<void> {
  await assertImportableDatabase(data)

  await autoSaveController.flush()
  await autoSaveController.stop()
  try {
    await storageAdapter.save(data)
  } catch (error) {
    // 失敗したらページは再読み込みされず編集が続くため、止めた自動保存を再開してから伝える
    // (再開しないと、画面は動くのに以後の変更が保存されない、計画Issue #175)。成功時は再読み込みで起動し直す。
    autoSaveController.resume()
    throw error
  }
}
