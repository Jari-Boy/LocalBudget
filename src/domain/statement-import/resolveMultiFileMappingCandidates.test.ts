/**
 * 複数CSVの一括取込(計画Issue #214、docs/domain/statement-import.md 1.5手順1)で、全ファイルに共通して使える
 * マッピング定義の候補を決めるresolveMultiFileMappingCandidatesのユニットテスト。
 * ファイルごとにresolveMappingDefinitionCandidatesで実パースを試み、より多くのファイルを読める定義だけを
 * 候補として返す。その定義で読めないファイルは「取り込めなかったファイル」として理由つきで返す
 * (全体を止めず、残りで続行できるようにする)。1ファイルだけのときは従来の絞り込みと同じ結果になる。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { resolveMultiFileMappingCandidates } from './resolveMultiFileMappingCandidates'

function definition(overrides: Partial<ImportMappingDefinition> = {}): ImportMappingDefinition {
  return {
    id: 1,
    accountIds: [],
    formatGroupId: 'test-card',
    isSettled: null,
    label: 'カードA',
    encoding: 'utf-8',
    delimiter: ',',
    headerRowCount: 1,
    dateColumn: '利用日',
    dateFormat: 'YYYY/MM/DD',
    descriptionColumn: '摘要',
    amountMode: 'single_signed',
    amountColumn: '金額',
    debitColumn: null,
    creditColumn: null,
    balanceColumn: null,
    externalIdColumn: null,
    invertAmountSign: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function file(fileName: string, content: string) {
  return { fileName, bytes: new TextEncoder().encode(content) }
}

const CARD_A_CSV = '利用日,摘要,金額\n2025/10/01,スーパー,-100\n'
const CARD_B_CSV = '日付,店名,支払額\n2025/10/01,スーパー,-100\n'

describe('resolveMultiFileMappingCandidates', () => {
  it('全ファイルが同じ定義で読めるとき、その定義を候補にし、除外するファイルは無い', () => {
    const result = resolveMultiFileMappingCandidates(
      [file('a.csv', CARD_A_CSV), file('b.csv', CARD_A_CSV)],
      [definition()],
    )

    expect(result).toHaveLength(1)
    expect(result[0].definition.id).toBe(1)
    expect(result[0].files.map((f) => f.fileName)).toEqual(['a.csv', 'b.csv'])
    expect(result[0].excluded).toEqual([])
  })

  it('読み込んだファイルの生データ(行×列)を、ファイルごとに保持する', () => {
    const result = resolveMultiFileMappingCandidates([file('a.csv', CARD_A_CSV)], [definition()])

    expect(result[0].files[0].rows).toEqual([
      ['利用日', '摘要', '金額'],
      ['2025/10/01', 'スーパー', '-100'],
    ])
  })

  it('別の形式のファイルが混ざっているとき、そのファイルだけを除外して理由(見つからない列)を返し、残りで続行できる', () => {
    const result = resolveMultiFileMappingCandidates(
      [file('a.csv', CARD_A_CSV), file('other.csv', CARD_B_CSV)],
      [definition()],
    )

    expect(result).toHaveLength(1)
    expect(result[0].files.map((f) => f.fileName)).toEqual(['a.csv'])
    expect(result[0].excluded).toEqual([
      { fileName: 'other.csv', reason: { kind: 'noDefinition', missingColumn: { fieldName: 'dateColumn', columnSpec: '利用日' } } },
    ])
  })

  it('どの定義でも読めないファイルは「noDefinition」、別の定義なら読めるファイルは「otherDefinition」として除外する', () => {
    const cardA = definition({ id: 1, label: 'カードA' })
    const cardB = definition({ id: 2, label: 'カードB', dateColumn: '日付', descriptionColumn: '店名', amountColumn: '支払額' })

    const result = resolveMultiFileMappingCandidates(
      [file('a1.csv', CARD_A_CSV), file('a2.csv', CARD_A_CSV), file('b.csv', CARD_B_CSV), file('junk.csv', 'x,y\n1,2\n')],
      [cardA, cardB],
    )

    expect(result).toHaveLength(1)
    expect(result[0].definition.id).toBe(1)
    expect(result[0].excluded.map((e) => [e.fileName, e.reason.kind])).toEqual([
      ['b.csv', 'otherDefinition'],
      ['junk.csv', 'noDefinition'],
    ])
  })

  it('読めるファイル数が同じ定義が複数あるとき、すべてを候補として返す(利用者が表示名で選ぶ)', () => {
    const settled = definition({ id: 1, label: 'カードA(確定)', isSettled: true })
    const preview = definition({ id: 2, label: 'カードA(速報)', isSettled: false })

    const result = resolveMultiFileMappingCandidates([file('a.csv', CARD_A_CSV)], [settled, preview])

    expect(result.map((m) => m.definition.id)).toEqual([1, 2])
  })

  it('どのファイルも読める定義が無いとき、空配列を返す', () => {
    const result = resolveMultiFileMappingCandidates([file('junk.csv', 'x,y\n1,2\n')], [definition()])

    expect(result).toEqual([])
  })
})
