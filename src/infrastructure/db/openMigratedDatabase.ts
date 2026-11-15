import type { Database } from 'sql.js'
import { SchemaTooNewError } from './migrationErrors'
import { SCHEMA_PLAN, needsMigration, runMigrations, type MigrationPlan } from './migrations'

export type StartupDatabaseErrorReason = 'schema-too-new' | 'migration-failed'

/**
 * 起動時のDB準備に失敗したことを表す(計画Issue #42)。画面が原因ごとに案内を出し、
 * 起動時に読んだ元のバイト列(originalData)を「データを書き出す」で渡せるようにする。
 * originalDataがnullなのは、保存データが無かったとき(新規作成の失敗)。
 */
export class StartupDatabaseError extends Error {
  readonly reason: StartupDatabaseErrorReason
  readonly originalData: Uint8Array | null
  readonly databaseVersion: number | null
  readonly latestVersion: number | null

  constructor(
    reason: StartupDatabaseErrorReason,
    message: string,
    details: {
      originalData: Uint8Array | null
      databaseVersion?: number
      latestVersion?: number
      cause?: unknown
    },
  ) {
    super(message, { cause: details.cause })
    this.name = 'StartupDatabaseError'
    this.reason = reason
    this.originalData = details.originalData
    this.databaseVersion = details.databaseVersion ?? null
    this.latestVersion = details.latestVersion ?? null
  }
}

export interface OpenMigratedDatabaseDeps {
  /** 保存先から読んだバイト列。保存データが無ければnull */
  savedData: Uint8Array | null
  createDatabase(data?: Uint8Array): Promise<Database>
  /** 保存先へ直ちに保存する(移行の成功後に1回) */
  save(data: Uint8Array): Promise<void>
  /** 移行を流す前の元のバイト列を、保存先ごとのバックアップへ保存する(直近の1つだけ残る) */
  saveBackup(data: Uint8Array): Promise<void>
  /** 書き込みの権利があるか。無い(読み取り専用の)タブは、メモリ上でだけ移行し、バックアップも保存もしない */
  writable: boolean
  plan?: MigrationPlan
}

/**
 * Worker起動時のDB準備(計画Issue #42、docs/architecture.md 5章)。保存データでDBを開き、最新スキーマにする。
 * 既存DBの移行では、①元のバイト列をバックアップ → ②差分を1トランザクションで適用 → ③直ちに保存、の順に行う。
 * どこかで失敗したらDBを閉じ、元のバイト列を添えたStartupDatabaseErrorを投げる(起動は止まり、保存先は変わらない。
 * ③の保存が失敗した場合も止める: 保存の成否が不明なまま編集を始めると、どちらの状態が残るか分からないため)。
 * 新しすぎるバージョンのDBは開かない(schema-too-new)。
 */
export async function openMigratedDatabase(deps: OpenMigratedDatabaseDeps): Promise<Database> {
  const plan = deps.plan ?? SCHEMA_PLAN
  const original = deps.savedData
  const db = await deps.createDatabase(original ?? undefined)

  try {
    const migrating = needsMigration(db, plan)
    if (migrating && deps.writable && original !== null) {
      await deps.saveBackup(original)
    }
    runMigrations(db, plan)
    if (migrating && deps.writable) {
      await deps.save(db.export())
      // db.export()は外部キー制約をOFFに戻す副作用を持つ
      db.run('PRAGMA foreign_keys = ON')
    }
    return db
  } catch (error) {
    db.close()
    if (error instanceof SchemaTooNewError) {
      throw new StartupDatabaseError('schema-too-new', error.message, {
        originalData: original,
        databaseVersion: error.databaseVersion,
        latestVersion: error.latestVersion,
        cause: error,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new StartupDatabaseError('migration-failed', message, {
      originalData: original,
      cause: error,
    })
  }
}
