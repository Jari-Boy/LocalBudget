/**
 * docs 内の相対リンクの検査(計画Issue #310)。
 *
 * 検査する内容:
 *   - Markdown の相対リンクが指すファイル・ディレクトリが存在する(link-not-found)
 *   - `#アンカー` が、リンク先の .md の見出しに存在する(link-anchor-not-found)
 * http(s)・mailto 等の外部リンク、コードブロックとインラインコードの中は対象外。
 * 見出しのスラッグは GitHub 方式(小文字化・記号除去・空白をハイフンに・同名見出しは -1, -2 を付与)。
 *
 * ファイルシステムには触れない純粋関数。呼び出し側(checkBundle)が { path, text } の配列と存在判定関数を渡す。
 */
import { posix } from 'node:path'

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const EXTERNAL_PATTERN = /^[a-z][a-z0-9+.-]*:/i

function violation(path, rule, message) {
  return { path, rule, message }
}

/** 見出しの文字列を、GitHub 方式のアンカー(スラッグ)にする。 */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** コードブロックを除いた行を返す(```で囲まれた範囲を空行に置き換える)。 */
function stripFencedCode(text) {
  let inFence = false
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence
        return ''
      }
      return inFence ? '' : line
    })
}

/** 文書の見出しから、リンクで指せるアンカーの集合を作る。 */
function collectAnchors(text) {
  const anchors = new Set()
  const seen = new Map()
  for (const line of stripFencedCode(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    const base = slugify(heading[1].replace(/`/g, ''))
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

/** 文書から相対リンクの href を取り出す(コードブロック・インラインコードの中を除く)。 */
function collectHrefs(text) {
  const body = stripFencedCode(text).join('\n').replace(/`[^`\n]*`/g, 'x')
  return [...body.matchAll(LINK_PATTERN)].map((match) => match[1]).filter((href) => !EXTERNAL_PATTERN.test(href))
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * バンドル(docs 一式)の相対リンクを検査する。files は { path, text }(path はリポジトリルート基準の posix 形式)。
 * exists は .md 以外(sql・ディレクトリなど)の存在確認用。
 */
export function checkLinks(files, { exists }) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const anchorCache = new Map()
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, collectAnchors(byPath.get(path).text))
    return anchorCache.get(path)
  }

  const violations = []
  for (const { path, text } of files) {
    for (const href of collectHrefs(text)) {
      const hashIndex = href.indexOf('#')
      const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex)
      const anchor = hashIndex === -1 ? '' : safeDecode(href.slice(hashIndex + 1))

      const resolved =
        rawPath === '' ? path : posix.normalize(posix.join(posix.dirname(path), safeDecode(rawPath))).replace(/\/$/, '')
      const outside = resolved.startsWith('..')
      const known = byPath.has(resolved)
      if (outside || (!known && !exists(resolved))) {
        violations.push(violation(path, 'link-not-found', `リンク先が存在しない: ${href}`))
        continue
      }
      if (anchor !== '' && known && !anchorsOf(resolved).has(anchor)) {
        violations.push(violation(path, 'link-anchor-not-found', `リンク先に見出しが無い: ${href}`))
      }
    }
  }
  return violations
}
