/**
 * docs 内の相対リンク(ファイルの実在・見出しアンカーの実在)の検査(checkLinks.mjs)のテスト(計画Issue #310)。
 *
 * 検証対象: Markdown の相対リンクが指すファイル・ディレクトリの存在、`#アンカー` が指す見出しの存在
 * (GitHub 方式のスラッグ: 小文字化・記号除去・空白をハイフンに・同名見出しは -1, -2 を付与)、
 * コードブロック・インラインコード内のリンクの除外、http(s) 等の外部リンクの除外。
 * 外部依存: なし。ファイルシステムには触れず、{ path, text } の配列と存在判定関数を引数で受ける純粋関数としてテストする。
 */
import { describe, expect, it } from 'vitest'
import { checkLinks, slugify } from './checkLinks.mjs'

const check = (files, existing = []) => checkLinks(files, { exists: (path) => existing.includes(path) })
const rules = (violations) => violations.map((v) => `${v.path}:${v.rule}`)

describe('slugify', () => {
  it('英字は小文字にし、空白をハイフンにし、記号を除く', () => {
    expect(slugify('1.2 Is_Reconcilable (資産)')).toBe('12-is_reconcilable-資産')
  })

  it('日本語の見出しは文字を残し、全角の括弧・読点・中黒などを除く', () => {
    expect(slugify('1.9 精算画面の操作モデル(計画Issue #139、割勘・精算)')).toBe('19-精算画面の操作モデル計画issue-139割勘精算')
  })

  it('見出し内のインラインコードの記号とバッククォートを除く', () => {
    expect(slugify('2. 勘定科目マスタ(`accounts`)')).toBe('2-勘定科目マスタaccounts')
  })
})

describe('checkLinks', () => {
  const target = { path: 'docs/domain/journal.md', text: '# 仕訳\n\n## 1.1 仕訳(JournalEntry)\n\n## 1.1 仕訳(JournalEntry)\n' }

  it('存在するファイルと見出しアンカーへのリンクは違反なし', () => {
    const from = { path: 'docs/domain.md', text: '[a](./domain/journal.md#11-仕訳journalentry) [b](./domain/journal.md)' }
    expect(check([from, target])).toEqual([])
  })

  it('同名の見出しの2つ目は -1 を付けたアンカーで指せる', () => {
    const from = { path: 'docs/domain.md', text: '[a](./domain/journal.md#11-仕訳journalentry-1)' }
    expect(check([from, target])).toEqual([])
  })

  it('存在しないファイルへのリンクは link-not-found として報告する', () => {
    const from = { path: 'docs/domain.md', text: '[a](./domain/missing.md)' }
    expect(rules(check([from]))).toEqual(['docs/domain.md:link-not-found'])
  })

  it('存在しない見出しアンカーへのリンクは link-anchor-not-found として報告する', () => {
    const from = { path: 'docs/domain.md', text: '[a](./domain/journal.md#99-ない)' }
    expect(rules(check([from, target]))).toEqual(['docs/domain.md:link-anchor-not-found'])
  })

  it('同じ文書内の #アンカー も検査する', () => {
    const doc = { path: 'docs/a.md', text: '# 見出し\n[ok](#見出し) [ng](#ない)' }
    expect(rules(check([doc]))).toEqual(['docs/a.md:link-anchor-not-found'])
  })

  it('.md 以外の相対リンク(sql・ディレクトリ)は exists で存在を確認する', () => {
    const from = { path: 'docs/domain/a.md', text: '[sql](../schema/a.sql) [dir](../decisions/) [none](../schema/none.sql)' }
    const violations = check([from], ['docs/schema/a.sql', 'docs/decisions'])
    expect(violations.map((v) => v.message)).toEqual([expect.stringContaining('none.sql')])
  })

  it('http(s)・mailto のリンクは対象外とする', () => {
    const from = { path: 'docs/a.md', text: '[x](https://example.com/a#b) [y](mailto:a@example.com)' }
    expect(check([from])).toEqual([])
  })

  it('コードブロックとインラインコードの中のリンク風の文字列は対象外とする', () => {
    const text = '```\n[a](./none.md)\n```\n`[b](./none.md)`\n'
    expect(check([{ path: 'docs/a.md', text }])).toEqual([])
  })

  it('コードブロック内の # 行は見出しとして扱わない', () => {
    const doc = { path: 'docs/a.md', text: '```\n# 偽の見出し\n```\n[x](#偽の見出し)' }
    expect(rules(check([doc]))).toEqual(['docs/a.md:link-anchor-not-found'])
  })

  it('リンクのタイトル付き記法 [a](./b.md "title") も解析する', () => {
    const from = { path: 'docs/a.md', text: '[a](./none.md "説明")' }
    expect(rules(check([from]))).toEqual(['docs/a.md:link-not-found'])
  })

  it('リポジトリ外へ出るリンクは存在しないものとして扱う', () => {
    const from = { path: 'docs/a.md', text: '[a](../../../outside.md)' }
    expect(rules(check([from]))).toEqual(['docs/a.md:link-not-found'])
  })
})
