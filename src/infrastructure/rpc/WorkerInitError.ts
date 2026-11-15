export type WorkerInitErrorReason = 'schema-too-new' | 'migration-failed' | 'other'

/**
 * Worker初期化の失敗(計画Issue #42)。メインスレッドの画面が、原因ごとに案内を出し分け、
 * 移行前の元のDB(originalData)を書き出せるようにする。
 */
export class WorkerInitError extends Error {
  readonly reason: WorkerInitErrorReason
  readonly originalData: Uint8Array | null
  readonly databaseVersion: number | null
  readonly latestVersion: number | null

  constructor(
    message: string,
    details: {
      reason?: WorkerInitErrorReason
      originalData?: Uint8Array | null
      databaseVersion?: number | null
      latestVersion?: number | null
    } = {},
  ) {
    super(message)
    this.name = 'WorkerInitError'
    this.reason = details.reason ?? 'other'
    this.originalData = details.originalData ?? null
    this.databaseVersion = details.databaseVersion ?? null
    this.latestVersion = details.latestVersion ?? null
  }
}
