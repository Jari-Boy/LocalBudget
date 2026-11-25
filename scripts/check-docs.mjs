/**
 * docs の OKF(v0.2)準拠チェックの CLI(計画Issue #284)。`npm run docs:check` で実行する。
 * docs/ 配下の .md を走査し、SPEC の適合条件と frontmatter の resource が指すパスの存在を検査して、
 * 違反があれば一覧を表示して終了コード 1 で終わる。検査ロジックは docs-check/checkDocs.mjs(テスト済み)。
 * ここはファイルの読み込みと出力だけを担う。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBundle } from './docs-check/checkDocs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = 'docs'

/** ディレクトリ配下の .md をリポジトリルート基準の posix パスで列挙する。 */
function listMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(full)
    return entry.name.endsWith('.md') ? [relative(root, full).split('\\').join('/')] : []
  })
}

const files = listMarkdownFiles(join(root, rootDir)).map((path) => ({
  path,
  text: readFileSync(join(root, path), 'utf-8'),
}))
const violations = checkBundle(files, { rootDir, exists: (path) => existsSync(join(root, path)) })

if (violations.length === 0) {
  console.log(`docs: ${files.length} ファイルすべて OKF v0.2 の適合条件を満たしています。`)
} else {
  for (const { path, rule, message } of violations) console.error(`${path}  [${rule}]  ${message}`)
  console.error(`\n${violations.length} 件の違反(${files.length} ファイル中)`)
  process.exitCode = 1
}
