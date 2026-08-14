/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
import { seedBuiltInMappingDefinitions } from '../db/seedBuiltInMappingDefinitions'
import { seedDefaultAccounts } from '../db/seedDefaultAccounts'
import { seedDefaultHouseholdMember } from '../db/seedDefaultHouseholdMember'
import { createRepositoryRegistry } from '../rpc/createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from '../rpc/registerDomainErrorTransferHandler'
import { WORKER_READY_MESSAGE, createWorkerInitErrorMessage } from '../rpc/workerLifecycleMessages'
import { IndexedDBStorageAdapter } from '../storage/IndexedDBStorageAdapter'
import { withAutoSave } from '../storage/withAutoSave'

/**
 * Web Workerのエントリポイント(docs/architecture.md 5章)。sql.jsのWASM初期化は非同期のため、
 * Comlink.exposeによるメッセージリスナー登録が完了する前にメインスレッドからRPC呼び出しが
 * 届くと、応答されずに失われる(実測で確認済み)。DB初期化・マイグレーション・expose完了後に
 * WORKER_READY_MESSAGEを送出し、メインスレッド側(createDbClient/waitForWorkerReady)は
 * これを待ってからComlink.wrap()する。初期化中に例外が発生した場合はworker-init-error
 * メッセージを送出し、メインスレッド側のPromiseを無期限にハングさせず確実にrejectさせる。
 * 起動時はIndexedDBStorageAdapterから既存DBのバイト列をロードして復元し(計画Issue #25、
 * FileSystemAccessStorageAdapterへの対応・保存先切り替えは別Issue)、マイグレーション適用後
 * withAutoSaveでDB変更をtrailing debounce(計画Issue #58)で永続化する。withAutoSaveが返す
 * AutoSaveControllerはRepositoryRegistryのautoSaveキーとして公開し、メインスレッド側が
 * ページ非表示時等にRPC越しにflush()を呼べるようにする。同じstorageAdapterインスタンスは
 * バックアップのインポート(計画Issue #26)がStorageAdapterへの検証済みバイト列の保存にも
 * 使うため、createRepositoryRegistryへそのまま渡す。マイグレーション適用直後に
 * seedBuiltInMappingDefinitions(計画Issue #76、docs/domain/statement-import.md 2.3節)を
 * 呼び出し、OSS同梱の組み込みマッピング定義(楽天カード・楽天銀行・PayPayカード等)を
 * account_id = NULLの汎用定義として投入する(冪等、既存定義があれば再投入しない)。同様に
 * seedDefaultHouseholdMember(計画Issue #88、docs/domain/household-members.md 1.2節)を呼び出し、
 * household_membersが0件ならデフォルトメンバーを1件自動投入する(冪等)。仕訳作成には起票者
 * (journal_entries.household_member_id)がNOT NULLで必須なため、この投入により口座登録・
 * 仕訳入力等の初回操作時に世帯メンバーが1件も無く選択できないという状態を避けられる。同様に
 * seedDefaultAccounts(計画Issue #96、docs/domain/accounts.md 1.2節)を呼び出し、revenue・
 * expense区分それぞれについて1件も科目が存在しなければ標準的な収益・費用科目一式を投入する
 * (区分ごとに独立して冪等)。口座(資産科目)登録直後から相手科目に困らず仕訳を作成できる状態を
 * 保証するための投入であり、資産・負債・純資産区分の科目には一切関与しない。
 */
async function main(): Promise<void> {
  registerDomainErrorTransferHandler()

  const storageAdapter = new IndexedDBStorageAdapter()
  const savedData = await storageAdapter.load()

  const db = await createBrowserDatabase(savedData ?? undefined)
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedBuiltInMappingDefinitions(db)
  seedDefaultAccounts(db)
  const autoSaveController = withAutoSave(db, storageAdapter)

  const registry = createRepositoryRegistry(db, autoSaveController, storageAdapter)
  Comlink.expose(registry)

  postMessage(WORKER_READY_MESSAGE)
}

main().catch((error: unknown) => {
  postMessage(createWorkerInitErrorMessage(error))
})
