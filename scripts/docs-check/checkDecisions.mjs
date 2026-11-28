/**
 * 意思決定ログ(docs/decisions/ 配下の「1決定=1ファイル」)の検査(計画Issue #310)。
 *
 * 検査する内容:
 *   - ファイル名は `YYYY-MM-DD-NN.md`、`type` は `Decision`、frontmatter の `date` はファイル名の日付と一致する
 *   - 置き換え関係(supersedes / partially_supersedes / superseded_by / partially_superseded_by)の参照先が実在し、
 *     双方向で対応し、日付の前後関係が逆転していない
 *   - 全面的に置き換えられた決定(superseded_by あり)だけが `status: deprecated` を持つ
 *   - 本文中の `decisions/YYYY-MM-DD-NN.md` という参照が、実在する決定を指す
 *   - index.md が、すべての決定を「現行の決定」「置き換え済みの決定」の正しい節に1回ずつ載せている
 *
 * ファイルシステムには触れない純粋関数。呼び出し側(checkBundle)が { path, text } の配列を渡す。
 */
import { posix } from 'node:path'
import { parseFrontmatter } from './checkDocs.mjs'

const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/
const SECTION_CURRENT = '現行の決定'
const SECTION_SUPERSEDED = '置き換え済みの決定'
const INDEX_ITEM_PATTERN = /^\*\s+\[[^\]]*\]\(\.\/([^)#\s]+)\.md\)/

/** 置き換え関係のキーと、対になるキー。 */
const RELATION_PAIRS = {
  supersedes: 'superseded_by',
  superseded_by: 'supersedes',
  partially_supersedes: 'partially_superseded_by',
  partially_superseded_by: 'partially_supersedes',
}
/** 自分より新しい決定を指すキー(参照先の日付 >= 自分の日付であること)。 */
const POINTS_TO_NEWER = ['superseded_by', 'partially_superseded_by']

function violation(path, rule, message) {
  return { path, rule, message }
}

/** frontmatter の値を文字列配列にそろえる(空・未指定は空配列)。 */
function toList(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== '')
  return typeof value === 'string' && value !== '' ? [value] : []
}

/** index.md から、節ごとの掲載 id(出現順、重複を含む)を取り出す。 */
function parseIndex(text) {
  const sections = { [SECTION_CURRENT]: [], [SECTION_SUPERSEDED]: [] }
  let current = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.*?)\s*$/.exec(line)
    if (heading) {
      current = heading[1] in sections ? heading[1] : null
      continue
    }
    const item = INDEX_ITEM_PATTERN.exec(line)
    if (item && current !== null) sections[current].push(item[1])
  }
  return sections
}

/** 決定ファイル1件の形式と、置き換え関係のうち自分だけで判定できる部分を検査する。 */
function checkDecisionFile(path, decision, byId) {
  const violations = []
  const { id, data } = decision

  if (!ID_PATTERN.test(id)) {
    violations.push(violation(path, 'decision-id-invalid', `ファイル名は YYYY-MM-DD-NN.md の形にする: ${id}.md`))
  } else if (data.date !== id.slice(0, 10)) {
    violations.push(violation(path, 'decision-id-invalid', `date はファイル名の日付と一致させる: ${data.date}`))
  }
  if (data.type !== 'Decision') {
    violations.push(violation(path, 'decision-type-invalid', `type は Decision: ${data.type}`))
  }

  for (const key of Object.keys(RELATION_PAIRS)) {
    for (const targetId of toList(data[key])) {
      const target = byId.get(targetId)
      if (!target) {
        violations.push(violation(path, 'decision-link-not-found', `${key} が指す決定が存在しない: ${targetId}`))
        continue
      }
      if (targetId === id) {
        violations.push(violation(path, 'decision-order-invalid', `${key} が自分自身を指している`))
        continue
      }
      if (!toList(target.data[RELATION_PAIRS[key]]).includes(id)) {
        violations.push(
          violation(path, 'decision-link-asymmetric', `${key}: ${targetId} に対応する ${RELATION_PAIRS[key]} が無い`),
        )
      }
      const newer = POINTS_TO_NEWER.includes(key)
      if (newer ? target.data.date < data.date : target.data.date > data.date) {
        violations.push(
          violation(path, 'decision-order-invalid', `${key}: ${targetId} との日付の前後が逆(置き換えるのは新しい側)`),
        )
      }
    }
  }

  const fullySuperseded = toList(data.superseded_by).length > 0
  if (fullySuperseded && data.status !== 'deprecated') {
    violations.push(violation(path, 'decision-status-mismatch', 'superseded_by がある決定は status: deprecated にする'))
  }
  if (!fullySuperseded && data.status === 'deprecated') {
    violations.push(
      violation(path, 'decision-status-mismatch', 'status: deprecated は superseded_by がある決定だけに付ける'),
    )
  }
  return violations
}

/** index.md への掲載を検査する。 */
function checkDecisionIndex(indexPath, indexFile, decisions) {
  if (!indexFile) {
    return decisions.length === 0
      ? []
      : [violation(indexPath, 'decision-index-missing', '決定があるのに index.md が無い')]
  }

  const violations = []
  const sections = parseIndex(indexFile.text)
  const byId = new Map(decisions.map((decision) => [decision.id, decision]))
  const listed = new Map()

  for (const [section, ids] of Object.entries(sections)) {
    for (const id of ids) {
      const decision = byId.get(id)
      if (!decision) {
        violations.push(violation(indexPath, 'decision-index-unknown', `実在しない決定を載せている: ${id}`))
        continue
      }
      listed.set(id, (listed.get(id) ?? 0) + 1)
      const shouldBeSuperseded = toList(decision.data.superseded_by).length > 0
      if ((section === SECTION_SUPERSEDED) !== shouldBeSuperseded) {
        violations.push(violation(indexPath, 'decision-index-section', `${id} は「${section}」の節ではない`))
      }
    }
  }

  for (const decision of decisions) {
    const count = listed.get(decision.id) ?? 0
    if (count === 0) {
      violations.push(violation(indexPath, 'decision-index-missing', `index.md に載っていない決定: ${decision.id}`))
    } else if (count > 1) {
      violations.push(violation(indexPath, 'decision-index-duplicate', `index.md に複数回載っている決定: ${decision.id}`))
    }
  }
  return violations
}

/** 本文中の `decisions/YYYY-MM-DD-NN.md` という参照(インラインコード・Markdown リンクの別を問わない)が、実在する決定を指すか検査する。 */
function checkDecisionReferences(files, byId) {
  const violations = []
  for (const { path, text } of files) {
    const reported = new Set()
    for (const match of text.matchAll(/decisions\/(\d{4}-\d{2}-\d{2}-\d{2})\.md/g)) {
      if (byId.has(match[1]) || reported.has(match[1])) continue
      reported.add(match[1])
      violations.push(violation(path, 'decision-ref-not-found', `存在しない決定を参照している: ${match[1]}`))
    }
  }
  return violations
}

/**
 * docs/decisions/ 配下の決定ファイルと index.md を検査する。rootDir はバンドルルート(例: 'docs')。
 * 解析できない frontmatter は概念文書の検査(checkConceptDocument)が報告するため、ここでは対象から外す。
 */
export function checkDecisions(files, { rootDir }) {
  const dir = posix.join(rootDir, 'decisions')
  const inDir = files.filter((file) => posix.dirname(file.path) === dir)
  const indexPath = posix.join(dir, 'index.md')
  const indexFile = inDir.find((file) => file.path === indexPath)

  const decisions = []
  for (const file of inDir) {
    if (file.path === indexPath || posix.basename(file.path) === 'log.md' || !file.path.endsWith('.md')) continue
    const parsed = parseFrontmatter(file.text)
    if (!parsed.found || parsed.error) continue
    decisions.push({ path: file.path, id: posix.basename(file.path, '.md'), data: parsed.data })
  }

  const byId = new Map(decisions.map((decision) => [decision.id, decision]))
  const violations = []
  for (const decision of decisions) violations.push(...checkDecisionFile(decision.path, decision, byId))
  violations.push(...checkDecisionIndex(indexPath, indexFile, decisions))
  violations.push(...checkDecisionReferences(files, byId))
  return violations
}
