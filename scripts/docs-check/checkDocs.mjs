/**
 * docs の OKF(Open Knowledge Format v0.2)準拠チェックのロジック(計画Issue #284)。
 * 仕様: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 *
 * SPEC に lint が無いため自作する。検査は SPEC の適合条件(§11)とパス存在確認に絞る(作り込まない方針)。
 *   - 予約名以外の全 .md が、解析可能な frontmatter と空でない `type` を持つ
 *   - index.md(§8)は frontmatter を持たない(バンドルルートのみ okf_version を許容)
 *   - log.md(§9)は ISO 8601 の日付見出し(YYYY-MM-DD)を新しい順に並べる
 *   - frontmatter の `resource` が指すパスが存在する(http(s) は対象外)
 *   - status / stale_after は、書かれている場合のみ値の形式を検査する(§5.4 / §5.5)
 *
 * frontmatter は外部の YAML ライブラリを使わず、docs で使う部分集合(キー: 値 / インライン配列 / ブロック配列)
 * だけを解釈する最小パーサで読む。`{ by: x, at: y }` のような入れ子の値は生の文字列として保持する。
 * ファイルシステムには触れない純粋関数で構成し、CLI(../check-docs.mjs)が入出力を担う。
 */
import { posix } from 'node:path'
import { checkDecisions } from './checkDecisions.mjs'
import { checkLinks } from './checkLinks.mjs'

const RESERVED_FILE_NAMES = ['index.md', 'log.md']
const STATUS_VALUES = ['draft', 'stable', 'deprecated']
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const KEY_LINE_PATTERN = /^([^\s:#][^\s:]*):(?:\s+(.*))?$/
const LIST_ITEM_PATTERN = /^\s+-\s+(.*)$/

/** frontmatter の値から前後の引用符を外す。 */
function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if (first === '"' && last === '"') {
      // 二重引用符の値は JSON 文字列と同じエスケープ(\" と \\ など)を戻す。解釈できなければ引用符だけ外す。
      try {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === 'string') return parsed
      } catch {
        return trimmed.slice(1, -1)
      }
    }
    if (first === "'" && last === "'") return trimmed.slice(1, -1)
  }
  return trimmed
}

/** `[a, b]` 形式のインライン配列なら文字列配列に、それ以外は引用符を外した文字列にする。 */
function parseScalarOrInlineList(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map(unquote)
  }
  return unquote(trimmed)
}

/**
 * 文書の先頭にある frontmatter を解析する。
 * 戻り値: { found, data?, body?, error? }。frontmatter が無ければ found=false、解析不能なら error を持つ。
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return { found: false, body: normalized }

  const closeIndex = lines.indexOf('---', 1)
  if (closeIndex === -1) return { found: true, error: '閉じの --- が見つからない' }

  const data = {}
  let currentListKey = null
  for (const line of lines.slice(1, closeIndex)) {
    if (line.trim() === '' || line.startsWith('#')) continue

    const item = LIST_ITEM_PATTERN.exec(line)
    if (item && currentListKey !== null) {
      if (!Array.isArray(data[currentListKey])) data[currentListKey] = []
      data[currentListKey].push(unquote(item[1]))
      continue
    }

    const key = KEY_LINE_PATTERN.exec(line)
    if (!key) return { found: true, error: `解析できない行: ${line}` }

    const [, name, raw = ''] = key
    if (raw.trim() === '') {
      // 値が空のキー。次行以降にブロック配列が続けば配列、続かなければ空文字のままになる。
      data[name] = ''
      currentListKey = name
      continue
    }
    data[name] = parseScalarOrInlineList(raw)
    currentListKey = null
  }

  return { found: true, data, body: lines.slice(closeIndex + 1).join('\n') }
}

/** 予約ファイル名(index.md / log.md)かどうか。どの階層でも概念文書には使えない(SPEC §3.1)。 */
export function isReservedFileName(path) {
  return RESERVED_FILE_NAMES.includes(posix.basename(path))
}

function violation(path, rule, message) {
  return { path, rule, message }
}

/** YYYY-MM-DD が実在する日付かどうか。 */
function isValidDate(text) {
  const match = DATE_PATTERN.exec(text)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** 概念文書(予約名以外の .md)の適合条件(SPEC §11)と、書かれている場合の status / stale_after の形式を検査する。 */
export function checkConceptDocument(path, text) {
  const parsed = parseFrontmatter(text)
  if (!parsed.found) return [violation(path, 'frontmatter-missing', 'frontmatter が無い')]
  if (parsed.error) return [violation(path, 'frontmatter-unparsable', parsed.error)]

  const violations = []
  const { type, status, stale_after: staleAfter } = parsed.data
  if (typeof type !== 'string' || type.trim() === '') {
    violations.push(violation(path, 'type-missing', 'type が無い、または空'))
  }
  if (status !== undefined && !STATUS_VALUES.includes(status)) {
    violations.push(violation(path, 'status-invalid', `status は ${STATUS_VALUES.join('/')} のいずれか: ${status}`))
  }
  if (staleAfter !== undefined && !(TIMESTAMP_PATTERN.test(staleAfter) && !Number.isNaN(Date.parse(staleAfter)))) {
    violations.push(
      violation(path, 'timestamp-invalid', `stale_after は UTC オフセット付きの ISO 8601 日時: ${staleAfter}`),
    )
  }
  return violations
}

/** index.md(SPEC §8)の検査。frontmatter は持たない(バンドルルートのみ okf_version を許容する)。 */
export function checkIndexDocument(path, text, { isRoot }) {
  const parsed = parseFrontmatter(text)
  if (!parsed.found) return []
  if (parsed.error) return [violation(path, 'frontmatter-unparsable', parsed.error)]

  const keys = Object.keys(parsed.data)
  const onlyOkfVersion = keys.length === 1 && keys[0] === 'okf_version'
  if (isRoot && onlyOkfVersion) return []
  return [
    violation(
      path,
      'index-frontmatter-forbidden',
      isRoot ? 'ルートの index.md の frontmatter は okf_version のみ許容' : 'index.md は frontmatter を持てない',
    ),
  ]
}

/** log.md(SPEC §9)の検査。frontmatter は持たず、`##` 見出しは実在する YYYY-MM-DD で新しい順に並ぶ。 */
export function checkLogDocument(path, text) {
  const parsed = parseFrontmatter(text)
  if (parsed.found) {
    return [violation(path, 'log-frontmatter-forbidden', 'log.md は frontmatter を持てない')]
  }

  const violations = []
  let previous = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.*?)\s*$/.exec(line)
    if (!heading) continue
    const date = heading[1]
    if (!isValidDate(date)) {
      violations.push(violation(path, 'log-date-invalid', `日付見出しは実在する YYYY-MM-DD: ${date}`))
      continue
    }
    if (previous !== null && date > previous) {
      violations.push(violation(path, 'log-order-invalid', `新しい順に並べる: ${previous} の後に ${date}`))
    }
    previous = date
  }
  return violations
}

/**
 * frontmatter の `resource` が指すパスの存在を確認する。
 * 相対パスは文書のあるディレクトリ基準、`/` 始まりはバンドルルート(rootDir)基準(SPEC §6.2)。
 * http(s) は対象外。リポジトリの外へ出るパスは存在しないものとして扱う。
 */
export function checkResourcePaths(path, text, exists, rootDir = '') {
  const parsed = parseFrontmatter(text)
  if (!parsed.found || parsed.error) return []

  const raw = parsed.data.resource
  const resources = (Array.isArray(raw) ? raw : [raw]).filter((value) => typeof value === 'string' && value !== '')

  const violations = []
  for (const resource of resources) {
    if (/^https?:\/\//.test(resource)) continue
    const resolved = resource.startsWith('/')
      ? posix.normalize(posix.join(rootDir, resource))
      : posix.normalize(posix.join(posix.dirname(path), resource))
    const outside = resolved.startsWith('..')
    if (outside || !exists(resolved)) {
      violations.push(violation(path, 'resource-not-found', `resource が指すパスが存在しない: ${resource}`))
    }
  }
  return violations
}

/**
 * バンドル(docs 一式)を検査する。files は { path, text }(path はリポジトリルート基準の posix 形式)。
 * rootDir はバンドルルート(例: 'docs')。exists は resource の存在確認用(リポジトリルート基準の posix パスを受ける)。
 */
export function checkBundle(files, { rootDir, exists }) {
  const violations = []
  for (const { path, text } of files) {
    const name = posix.basename(path)
    if (name === 'index.md') {
      violations.push(...checkIndexDocument(path, text, { isRoot: path === posix.join(rootDir, 'index.md') }))
    } else if (name === 'log.md') {
      violations.push(...checkLogDocument(path, text))
    } else {
      violations.push(...checkConceptDocument(path, text), ...checkResourcePaths(path, text, exists, rootDir))
    }
  }
  violations.push(...checkDecisions(files, { rootDir }), ...checkLinks(files, { exists }))
  return violations
}
