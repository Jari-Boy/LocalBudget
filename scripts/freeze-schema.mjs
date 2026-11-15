/**
 * スキーマ凍結スクリプト(計画Issue #42)。`npm run schema:freeze` で実行する。
 * 現在の最新スキーマ(docs/schema/*.sql)+初期投入データを、固定データ(フィクスチャ)として
 * src/infrastructure/db/schemaFixtures/v{N}.sql に保存する(N = LATEST_SCHEMA_VERSION)。
 * 以後、CIのテスト(schemaFixtures.test.ts)が「固定データ+差分」と「最新スキーマから新規作成」の一致を検査し、
 * 差分の書き忘れを検出する。初回の本番デプロイの直前に手作業で実行する(手順: docs/guides/schema-migration.md)。
 * 凍結済みのバージョンのフィクスチャは上書きしない(公開済みスキーマの記録なので不変)。
 * `?raw` インポートを含むTypeScriptを読むため、Viteのssrで読み込む(Node単体では実行できない)。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
})

try {
  const { LATEST_SCHEMA_VERSION } = await server.ssrLoadModule('/src/infrastructure/db/migrations.ts')
  const { createSchemaFixtureSql, schemaFixtureFileName } = await server.ssrLoadModule(
    '/src/infrastructure/db/createSchemaFixtureSql.ts',
  )
  const { createTestDatabase } = await server.ssrLoadModule('/src/infrastructure/db/createTestDatabase.ts')

  const target = resolve(root, 'src/infrastructure/db/schemaFixtures', schemaFixtureFileName(LATEST_SCHEMA_VERSION))
  if (existsSync(target)) {
    console.error(`凍結済みです: ${target}\n公開済みバージョンのフィクスチャは上書きしません。スキーマを変えたときは、バージョンを上げて差分を追加してください。`)
    process.exitCode = 1
  } else {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, await createSchemaFixtureSql(createTestDatabase), 'utf8')
    console.log(`凍結しました: ${target}`)
  }
} finally {
  await server.close()
}
