/**
 * 意思決定ログ(docs/decisions/ 配下の「1決定=1ファイル」)の検査(checkDecisions.mjs)のテスト(計画Issue #310)。
 *
 * 検証対象: 決定ファイルの形式(type・ファイル名と date の一致)、置き換え関係(supersedes / superseded_by など)の
 * 参照先の実在・双方向の整合・status との整合・日付の前後関係、index.md への掲載(現行と置き換え済みの区別)。
 * 外部依存: なし。ファイルシステムには触れず、{ path, text } の配列を受ける純粋関数としてテストする。
 */
import { describe, expect, it } from 'vitest'
import { checkDecisions } from './checkDecisions.mjs'

const ROOT = 'docs'

/** frontmatter と本文から決定ファイルを組み立てる。 */
function decision(id, fields = {}, body = '## 見出し') {
  const lines = ['type: Decision', `title: "決定${id}"`, `date: ${id.slice(0, 10)}`]
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`)
  }
  return { path: `docs/decisions/${id}.md`, text: `---\n${lines.join('\n')}\n---\n${body}\n` }
}

/** 現行と置き換え済みの2節を持つ index.md を組み立てる。 */
function indexOf(current, superseded = []) {
  const item = (id) => `* [決定${id}](./${id}.md) - 要約`
  return {
    path: 'docs/decisions/index.md',
    text: [
      '# 意思決定ログ',
      '',
      '## 現行の決定',
      '',
      ...current.map(item),
      '',
      '## 置き換え済みの決定',
      '',
      ...superseded.map(item),
      '',
    ].join('\n'),
  }
}

const run = (files) => checkDecisions(files, { rootDir: ROOT })
const rules = (files) => run(files).map((v) => `${v.path.split('/').pop()}:${v.rule}`)

describe('checkDecisions: 決定ファイルの形式', () => {
  it('形式・置き換え関係・index が整っていれば違反なし', () => {
    const old = decision('2026-08-11-01', { status: 'deprecated', superseded_by: ['2026-11-07-01'] })
    const next = decision('2026-11-07-01', { supersedes: ['2026-08-11-01'] })
    expect(run([old, next, indexOf(['2026-11-07-01'], ['2026-08-11-01'])])).toEqual([])
  })

  it('docs/decisions/ の外のファイルは対象にしない', () => {
    const other = { path: 'docs/guides/a.md', text: '---\ntype: Guide\n---\n' }
    expect(run([other])).toEqual([])
  })

  it('type が Decision でない決定ファイルは違反として報告する', () => {
    const file = decision('2026-08-11-01')
    file.text = file.text.replace('type: Decision', 'type: Guide')
    expect(rules([file, indexOf(['2026-08-11-01'])])).toEqual(['2026-08-11-01.md:decision-type-invalid'])
  })

  it('ファイル名が YYYY-MM-DD-NN.md の形でなければ違反として報告する', () => {
    const file = { ...decision('2026-08-11-01'), path: 'docs/decisions/memo.md' }
    expect(rules([file])).toContain('memo.md:decision-id-invalid')
  })

  it('date がファイル名の日付と一致しなければ違反として報告する', () => {
    const file = decision('2026-08-11-01')
    file.text = file.text.replace('date: 2026-08-11', 'date: 2026-08-12')
    expect(rules([file, indexOf(['2026-08-11-01'])])).toEqual(['2026-08-11-01.md:decision-id-invalid'])
  })
})

describe('checkDecisions: 置き換え関係', () => {
  it('置き換え先・元の決定が存在しなければ違反として報告する', () => {
    const next = decision('2026-11-07-01', { supersedes: ['2026-08-11-99'] })
    expect(rules([next, indexOf(['2026-11-07-01'])])).toEqual(['2026-11-07-01.md:decision-link-not-found'])
  })

  it('片方向だけの関係(supersedes に対応する superseded_by が無い)は違反として報告する', () => {
    const old = decision('2026-08-11-01')
    const next = decision('2026-11-07-01', { supersedes: ['2026-08-11-01'] })
    expect(rules([old, next, indexOf(['2026-08-11-01', '2026-11-07-01'])])).toContain(
      '2026-11-07-01.md:decision-link-asymmetric',
    )
  })

  it('一部の置き換え(partially_supersedes)も双方向で対応していなければ違反として報告する', () => {
    const old = decision('2026-08-11-01')
    const next = decision('2026-11-07-01', { partially_supersedes: ['2026-08-11-01'] })
    expect(rules([old, next, indexOf(['2026-08-11-01', '2026-11-07-01'])])).toContain(
      '2026-11-07-01.md:decision-link-asymmetric',
    )
  })

  it('一部の置き換えの双方向の関係は、置き換えられた側が現行のままなら違反なし', () => {
    const old = decision('2026-08-11-01', { partially_superseded_by: ['2026-11-07-01'] })
    const next = decision('2026-11-07-01', { partially_supersedes: ['2026-08-11-01'] })
    expect(run([old, next, indexOf(['2026-08-11-01', '2026-11-07-01'])])).toEqual([])
  })

  it('全面的に置き換えられた決定(superseded_by あり)が status: deprecated でなければ違反として報告する', () => {
    const old = decision('2026-08-11-01', { superseded_by: ['2026-11-07-01'] })
    const next = decision('2026-11-07-01', { supersedes: ['2026-08-11-01'] })
    expect(rules([old, next, indexOf(['2026-11-07-01'], ['2026-08-11-01'])])).toEqual([
      '2026-08-11-01.md:decision-status-mismatch',
    ])
  })

  it('superseded_by が無いのに status: deprecated の決定は違反として報告する', () => {
    const old = decision('2026-08-11-01', { status: 'deprecated' })
    expect(rules([old, indexOf(['2026-08-11-01'])])).toEqual(['2026-08-11-01.md:decision-status-mismatch'])
  })

  it('一部だけ置き換えられた決定が status: deprecated なら違反として報告する', () => {
    const old = decision('2026-08-11-01', { status: 'deprecated', partially_superseded_by: ['2026-11-07-01'] })
    const next = decision('2026-11-07-01', { partially_supersedes: ['2026-08-11-01'] })
    expect(rules([old, next, indexOf(['2026-11-07-01'], ['2026-08-11-01'])])).toContain(
      '2026-08-11-01.md:decision-status-mismatch',
    )
  })

  it('より古い日付の決定が新しい日付の決定を置き換えていれば違反として報告する', () => {
    const old = decision('2026-11-07-01', { status: 'deprecated', superseded_by: ['2026-08-11-01'] })
    const next = decision('2026-08-11-01', { supersedes: ['2026-11-07-01'] })
    expect(rules([old, next, indexOf(['2026-08-11-01'], ['2026-11-07-01'])])).toContain(
      '2026-08-11-01.md:decision-order-invalid',
    )
  })

  it('自分自身を置き換えていれば違反として報告する', () => {
    const self = decision('2026-08-11-01', { supersedes: ['2026-08-11-01'], superseded_by: ['2026-08-11-01'] })
    expect(rules([self, indexOf([], ['2026-08-11-01'])])).toContain('2026-08-11-01.md:decision-order-invalid')
  })
})

describe('checkDecisions: index.md への掲載', () => {
  it('index.md に載っていない決定は違反として報告する', () => {
    const file = decision('2026-08-11-01')
    expect(rules([file, indexOf([])])).toEqual(['index.md:decision-index-missing'])
  })

  it('index.md が無い場合も、決定が1件でもあれば違反として報告する', () => {
    expect(rules([decision('2026-08-11-01')])).toEqual(['index.md:decision-index-missing'])
  })

  it('実在しない決定を指す項目は違反として報告する', () => {
    expect(rules([indexOf(['2026-08-11-99'])])).toEqual(['index.md:decision-index-unknown'])
  })

  it('現行の決定が「置き換え済み」の節に載っていれば違反として報告する', () => {
    const file = decision('2026-08-11-01')
    expect(rules([file, indexOf([], ['2026-08-11-01'])])).toEqual(['index.md:decision-index-section'])
  })

  it('全面的に置き換えられた(superseded_by がある)決定が「現行」の節に載っていれば違反として報告する', () => {
    const old = decision('2026-08-11-01', { status: 'deprecated', superseded_by: ['2026-11-07-01'] })
    const next = decision('2026-11-07-01', { supersedes: ['2026-08-11-01'] })
    expect(rules([old, next, indexOf(['2026-08-11-01', '2026-11-07-01'])])).toEqual(['index.md:decision-index-section'])
  })

  it('同じ決定が複数回載っていれば違反として報告する', () => {
    const file = decision('2026-08-11-01')
    expect(rules([file, indexOf(['2026-08-11-01', '2026-08-11-01'])])).toEqual(['index.md:decision-index-duplicate'])
  })
})
