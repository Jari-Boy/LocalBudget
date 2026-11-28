/**
 * docs の OKF(Open Knowledge Format v0.2)準拠チェック(checkDocs.mjs)のテスト(計画Issue #284)。
 *
 * 検証対象: frontmatter の最小パーサ(parseFrontmatter)、概念文書の適合条件(checkConceptDocument)、
 * 予約ファイル index.md / log.md の構造(checkIndexDocument / checkLogDocument)、
 * frontmatter の resource が指すパスの存在確認(checkResourcePaths)、バンドル全体の検査(checkBundle)。
 * 仕様: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md の §3.1 / §8 / §9 / §11 / §12。
 * 外部依存: なし。ファイルシステムには触れず、文字列と存在判定関数を引数で受けるため純粋関数としてテストできる。
 */
import { describe, expect, it } from 'vitest'
import {
  checkBundle,
  checkConceptDocument,
  checkIndexDocument,
  checkLogDocument,
  checkResourcePaths,
  isReservedFileName,
  parseFrontmatter,
} from './checkDocs.mjs'

describe('parseFrontmatter', () => {
  it('先頭の --- で囲まれたブロックをキーと文字列値に解析し、本文を分離する', () => {
    const result = parseFrontmatter('---\ntype: Decision\ntitle: 意思決定ログ\n---\n# 本文\n')
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ type: 'Decision', title: '意思決定ログ' })
    expect(result.body).toBe('# 本文\n')
  })

  it('frontmatter が無い文書は found=false を返す', () => {
    expect(parseFrontmatter('# 見出し\n本文')).toMatchObject({ found: false })
  })

  it('閉じの --- が無い場合は解析不能としてエラーを返す', () => {
    const result = parseFrontmatter('---\ntype: Decision\n# 本文')
    expect(result.found).toBe(true)
    expect(result.error).toMatch(/閉じ/)
  })

  it('値にコロンを含む場合も最初のコロンでキーと値を分ける', () => {
    expect(parseFrontmatter('---\nresource: https://example.com/a\n---\n').data).toEqual({
      resource: 'https://example.com/a',
    })
  })

  it('引用符で囲まれた値は引用符を外して返す', () => {
    expect(parseFrontmatter('---\nokf_version: "0.2"\ntitle: \'a: b\'\n---\n').data).toEqual({
      okf_version: '0.2',
      title: 'a: b',
    })
  })

  it('インライン配列とブロック配列を文字列配列として解析する', () => {
    const inline = parseFrontmatter('---\ntags: [domain, journal]\n---\n')
    expect(inline.data).toEqual({ tags: ['domain', 'journal'] })
    const block = parseFrontmatter('---\ntags:\n  - domain\n  - journal\n---\n')
    expect(block.data).toEqual({ tags: ['domain', 'journal'] })
  })

  it('# で始まるコメント行と空行は無視する', () => {
    expect(parseFrontmatter('---\n# メモ\n\ntype: Guide\n---\n').data).toEqual({ type: 'Guide' })
  })

  it('キー: 値の形でも配列要素でもない行は解析不能としてエラーを返す', () => {
    const result = parseFrontmatter('---\ntype Decision\n---\n')
    expect(result.error).toMatch(/解析できない行/)
  })

  it('二重引用符で囲まれた値の \\" と \\\\ のエスケープを元の文字に戻す(決定ファイルの title・description 用)', () => {
    const result = parseFrontmatter('---\ntitle: "「a」を\\"b\\"にする: c\\\\d"\n---\n')
    expect(result.data).toEqual({ title: '「a」を"b"にする: c\\d' })
  })

  it('CRLF 改行の文書も同じ結果になる', () => {
    expect(parseFrontmatter('---\r\ntype: Guide\r\n---\r\n本文').data).toEqual({ type: 'Guide' })
  })
})

describe('isReservedFileName', () => {
  it('index.md と log.md を予約名として判定し、それ以外は判定しない', () => {
    expect(isReservedFileName('docs/index.md')).toBe(true)
    expect(isReservedFileName('docs/domain/log.md')).toBe(true)
    expect(isReservedFileName('docs/domain.md')).toBe(false)
    expect(isReservedFileName('docs/domain/journal.md')).toBe(false)
  })
})

describe('checkConceptDocument', () => {
  it('空でない type を持つ文書は違反なし', () => {
    expect(checkConceptDocument('docs/a.md', '---\ntype: Guide\n---\n本文')).toEqual([])
  })

  it('frontmatter が無い文書は違反として報告する', () => {
    const violations = checkConceptDocument('docs/a.md', '# 本文のみ')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ path: 'docs/a.md', rule: 'frontmatter-missing' })
  })

  it('type が欠けている・空の文書は違反として報告する', () => {
    expect(checkConceptDocument('docs/a.md', '---\ntitle: x\n---\n')[0]).toMatchObject({ rule: 'type-missing' })
    expect(checkConceptDocument('docs/a.md', '---\ntype:\n---\n')[0]).toMatchObject({ rule: 'type-missing' })
  })

  it('frontmatter が解析不能な文書は違反として報告する', () => {
    expect(checkConceptDocument('docs/a.md', '---\ntype Guide\n---\n')[0]).toMatchObject({
      rule: 'frontmatter-unparsable',
    })
  })

  it('status が draft/stable/deprecated 以外なら違反として報告する', () => {
    expect(checkConceptDocument('docs/a.md', '---\ntype: Guide\nstatus: wip\n---\n')[0]).toMatchObject({
      rule: 'status-invalid',
    })
    expect(checkConceptDocument('docs/a.md', '---\ntype: Guide\nstatus: deprecated\n---\n')).toEqual([])
  })

  it('stale_after が UTC オフセット付き ISO 8601 日時でなければ違反として報告する', () => {
    expect(checkConceptDocument('docs/a.md', '---\ntype: Guide\nstale_after: 2026-12-01\n---\n')[0]).toMatchObject({
      rule: 'timestamp-invalid',
    })
    expect(checkConceptDocument('docs/a.md', '---\ntype: Guide\nstale_after: 2026-12-01T00:00:00Z\n---\n')).toEqual([])
    expect(
      checkConceptDocument('docs/a.md', '---\ntype: Guide\nstale_after: 2026-12-01T09:00:00+09:00\n---\n'),
    ).toEqual([])
  })
})

describe('checkIndexDocument', () => {
  it('frontmatter の無い index.md は違反なし', () => {
    expect(checkIndexDocument('docs/domain/index.md', '# 一覧\n* [a](./a.md) - 説明\n', { isRoot: false })).toEqual([])
  })

  it('ルート以外の index.md が frontmatter を持つと違反として報告する', () => {
    const violations = checkIndexDocument('docs/domain/index.md', '---\ntype: Index\n---\n', { isRoot: false })
    expect(violations[0]).toMatchObject({ rule: 'index-frontmatter-forbidden' })
  })

  it('ルートの index.md は okf_version だけを frontmatter に持てる', () => {
    expect(checkIndexDocument('docs/index.md', '---\nokf_version: "0.2"\n---\n# 一覧\n', { isRoot: true })).toEqual([])
    const violations = checkIndexDocument('docs/index.md', '---\nokf_version: "0.2"\ntype: Index\n---\n', {
      isRoot: true,
    })
    expect(violations[0]).toMatchObject({ rule: 'index-frontmatter-forbidden' })
  })
})

describe('checkLogDocument', () => {
  it('日付見出しが YYYY-MM-DD で新しい順に並ぶ log.md は違反なし', () => {
    const text = '# 更新履歴\n\n## 2026-11-25\n* **Update**: a\n\n## 2026-11-01\n* **Creation**: b\n'
    expect(checkLogDocument('docs/log.md', text)).toEqual([])
  })

  it('日付形式でない ## 見出しは違反として報告する', () => {
    const violations = checkLogDocument('docs/log.md', '## 2026/11/25\n* a\n')
    expect(violations[0]).toMatchObject({ rule: 'log-date-invalid' })
  })

  it('存在しない日付(2月30日など)は違反として報告する', () => {
    expect(checkLogDocument('docs/log.md', '## 2026-02-30\n* a\n')[0]).toMatchObject({ rule: 'log-date-invalid' })
  })

  it('古い日付が新しい日付より先に並んでいると違反として報告する', () => {
    const violations = checkLogDocument('docs/log.md', '## 2026-11-01\n* a\n\n## 2026-11-25\n* b\n')
    expect(violations[0]).toMatchObject({ rule: 'log-order-invalid' })
  })

  it('frontmatter を持つ log.md は違反として報告する', () => {
    expect(checkLogDocument('docs/log.md', '---\ntype: Log\n---\n## 2026-11-25\n')[0]).toMatchObject({
      rule: 'log-frontmatter-forbidden',
    })
  })
})

describe('checkResourcePaths', () => {
  const exists = (path) => ['src/domain/journal.ts', 'docs/schema/journal.sql'].includes(path)

  it('文書のあるディレクトリ基準の相対パスで、バンドル外のコード(src/)を指す resource が存在すれば違反なし', () => {
    const text = '---\ntype: Schema\nresource: ../../src/domain/journal.ts\n---\n'
    expect(checkResourcePaths('docs/domain/journal.md', text, exists)).toEqual([])
  })

  it('/ 始まりの resource は SPEC どおりバンドルルート(rootDir)基準で解決して存在確認する', () => {
    const text = '---\ntype: Schema\nresource: /schema/journal.sql\n---\n'
    expect(checkResourcePaths('docs/domain/journal.md', text, exists, 'docs')).toEqual([])
  })

  it('存在しないパスを指す resource は違反として報告する', () => {
    const text = '---\ntype: Schema\nresource: ../../src/domain/missing.ts\n---\n'
    const violations = checkResourcePaths('docs/domain/journal.md', text, exists)
    expect(violations[0]).toMatchObject({ rule: 'resource-not-found', path: 'docs/domain/journal.md' })
  })

  it('リポジトリの外へ出る resource は存在しないものとして違反に報告する', () => {
    const text = '---\ntype: Schema\nresource: ../../../outside.ts\n---\n'
    expect(checkResourcePaths('docs/domain/journal.md', text, () => true)[0]).toMatchObject({
      rule: 'resource-not-found',
    })
  })

  it('http(s) の resource は存在確認の対象外とする', () => {
    const text = '---\ntype: Reference\nresource: https://example.com/spec\n---\n'
    expect(checkResourcePaths('docs/guides/a.md', text, () => false)).toEqual([])
  })

  it('resource が無い文書は対象外とする', () => {
    expect(checkResourcePaths('docs/a.md', '---\ntype: Guide\n---\n', () => false)).toEqual([])
  })

  it('配列で複数指定された resource をそれぞれ確認する', () => {
    const text = '---\ntype: Schema\nresource:\n  - ../src/domain/journal.ts\n  - ../src/domain/missing.ts\n---\n'
    const violations = checkResourcePaths('docs/a.md', text, exists)
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toContain('missing.ts')
  })
})

describe('checkBundle', () => {
  const files = [
    { path: 'docs/index.md', text: '---\nokf_version: "0.2"\n---\n# 一覧\n' },
    { path: 'docs/log.md', text: '## 2026-11-25\n* **Creation**: a\n' },
    { path: 'docs/domain.md', text: '---\ntype: Domain\n---\n本文' },
    { path: 'docs/guides/knowledge.md', text: '# frontmatter なし' },
  ]

  it('予約名は構造検査、それ以外は概念文書として検査し、違反をまとめて返す', () => {
    const violations = checkBundle(files, { rootDir: 'docs', exists: () => true })
    expect(violations.map((v) => `${v.path}:${v.rule}`)).toEqual(['docs/guides/knowledge.md:frontmatter-missing'])
  })

  it('バンドルルート直下の index.md だけを isRoot として扱う', () => {
    const nested = [{ path: 'docs/domain/index.md', text: '---\nokf_version: "0.2"\n---\n' }]
    const violations = checkBundle(nested, { rootDir: 'docs', exists: () => true })
    expect(violations[0]).toMatchObject({ rule: 'index-frontmatter-forbidden' })
  })

  it('相対リンクの切れ(ファイル・見出しアンカー)も合わせて返す', () => {
    const linked = [
      { path: 'docs/a.md', text: '---\ntype: Guide\n---\n# A\n[ok](./b.md#見出し) [ng](./b.md#ない) [none](./c.md)' },
      { path: 'docs/b.md', text: '---\ntype: Guide\n---\n# 見出し\n' },
    ]
    const violations = checkBundle(linked, { rootDir: 'docs', exists: () => false })
    expect(violations.map((v) => v.rule)).toEqual(['link-anchor-not-found', 'link-not-found'])
  })

  it('docs/decisions/ の決定ファイルは決定の検査(置き換え関係・index)も受ける', () => {
    const decisions = [
      { path: 'docs/decisions/2026-08-11-01.md', text: '---\ntype: Decision\ndate: 2026-08-11\n---\n## 見出し\n' },
    ]
    const violations = checkBundle(decisions, { rootDir: 'docs', exists: () => true })
    expect(violations.map((v) => v.rule)).toEqual(['decision-index-missing'])
  })

  it('resource の存在確認違反も合わせて返す', () => {
    const withResource = [{ path: 'docs/a.md', text: '---\ntype: Guide\nresource: ../src/none.ts\n---\n' }]
    const violations = checkBundle(withResource, { rootDir: 'docs', exists: () => false })
    expect(violations[0]).toMatchObject({ rule: 'resource-not-found' })
  })
})
