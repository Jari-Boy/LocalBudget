/**
 * inferMappingDefinitionDraft(列マッピングの推測、docs/domain/statement-import.md「目標」1.)の
 * 純粋関数としてのユニットテスト。readCsvが返す「行×列」の生データから
 * CreateImportMappingDefinitionInput相当のドラフトを推測することを検証する。
 * ヘッダー文言によるキーワードマッチングを主判定とし、ヘッダーが無い/一意にマッチしない場合は
 * 値のパターン(型)による候補ランキングへフォールバックすること、label・formatGroupId・
 * isSettledは常にnullのままであることを中心に検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { inferMappingDefinitionDraft } from './inferMappingDefinitionDraft'

describe('ヘッダーあり・金額1列符号付き形式', () => {
  it('ヘッダーのキーワードが一意にマッチする列を確定的な候補として返す', () => {
    const rows = [
      ['取引日', '摘要', '金額'],
      ['2026/07/20', 'セブンイレブン', '-150'],
      ['2026/07/21', '給与振込', '250000'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.headerRowCount).toBe(1)
    expect(draft.dateColumn).toEqual([{ columnIndex: 0, headerName: '取引日' }])
    expect(draft.descriptionColumn).toEqual([{ columnIndex: 1, headerName: '摘要' }])
    expect(draft.amountColumn).toEqual([{ columnIndex: 2, headerName: '金額' }])
    expect(draft.amountMode).toBe('single_signed')
  })

  it('金額列以外に候補となる数値列が無いため出金・入金・残高列は未設定のままになる', () => {
    const rows = [
      ['取引日', '摘要', '金額'],
      ['2026/07/20', 'セブンイレブン', '-150'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.debitColumn).toEqual([])
    expect(draft.creditColumn).toEqual([])
    expect(draft.balanceColumn).toEqual([])
  })
})

describe('ヘッダーあり・入金出金2列形式', () => {
  it('出金・入金・残高のヘッダーキーワードから各列を確定的な候補として返す', () => {
    const rows = [
      ['取引日', '摘要', '出金', '入金', '残高'],
      ['2026/07/20', 'セブンイレブン', '150', '', '9850'],
      ['2026/07/21', '給与振込', '', '250000', '259850'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.headerRowCount).toBe(1)
    expect(draft.debitColumn).toEqual([{ columnIndex: 2, headerName: '出金' }])
    expect(draft.creditColumn).toEqual([{ columnIndex: 3, headerName: '入金' }])
    expect(draft.balanceColumn).toEqual([{ columnIndex: 4, headerName: '残高' }])
    expect(draft.amountMode).toBe('debit_credit_split')
    expect(draft.amountColumn).toEqual([])
  })
})

describe('ヘッダー無し', () => {
  it('ヘッダー行が検出できない場合はheaderRowCountが0になり、全行がデータ行として扱われる', () => {
    const rows = [
      ['2026/07/20', 'セブンイレブン', '-150'],
      ['2026/07/21', '給与振込', '250000'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.headerRowCount).toBe(0)
    expect(draft.dateColumn).toEqual([{ columnIndex: 0, headerName: null }])
    expect(draft.descriptionColumn).toEqual([{ columnIndex: 1, headerName: null }])
  })

  it('型的に複数列が該当する場合、単一値に確定させず型ベースの候補をランキング付きで返す', () => {
    const rows = [
      ['2026/07/20', 'セブンイレブン', '150', '9850'],
      ['2026/07/21', '給与振込', '250000', '259850'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.balanceColumn).toEqual([
      { columnIndex: 2, headerName: null },
      { columnIndex: 3, headerName: null },
    ])
    expect(draft.amountMode).toBeNull()
  })
})

describe('ヘッダーのキーワードが一意に定まらない場合', () => {
  it('マッチした列を型ベースの一致度でランキングした候補として返す', () => {
    const rows = [
      ['取引日', '日付(参考)', '摘要', '金額'],
      ['2026/07/20', '2026/07/19', 'セブンイレブン', '-150'],
      ['2026/07/21', 'メモ', '給与振込', '250000'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.dateColumn).toEqual([
      { columnIndex: 0, headerName: '取引日' },
      { columnIndex: 1, headerName: '日付(参考)' },
    ])
  })
})

describe('クレジットカード明細形式(実データで判明したパターン)', () => {
  it('「利用金額」と月次内訳列が両方とも「金額」を含み曖昧でも、より具体的なキーワードで一意に確定する', () => {
    const rows = [
      ['利用日', '利用店名・商品名', '利用金額', '支払総額', '8月支払金額'],
      ['2026/07/18', 'AMAZON.CO.JP', '1455', '1455', '1455'],
      ['2026/07/14', 'コンビニ', '5610', '5610', '5610'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.amountColumn).toEqual([{ columnIndex: 2, headerName: '利用金額' }])
    expect(draft.amountMode).toBe('single_signed')
  })

  it('「ご利用日」の敬語接頭辞が無い「利用日」ヘッダーも一意に確定する', () => {
    const rows = [
      ['利用日', '利用店名・商品名', '利用金額'],
      ['2026/07/18', 'AMAZON.CO.JP', '1455'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.dateColumn).toEqual([{ columnIndex: 0, headerName: '利用日' }])
  })

  it('「利用店名・商品名」ヘッダーも摘要列として一意に確定する', () => {
    const rows = [
      ['利用日', '利用店名・商品名', '利用金額'],
      ['2026/07/18', 'AMAZON.CO.JP', '1455'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.descriptionColumn).toEqual([{ columnIndex: 1, headerName: '利用店名・商品名' }])
  })
})

describe('amountModeの判定はヘッダー確定だけでなく型フォールバックの一意な絞り込みも考慮する', () => {
  it('残高列がヘッダーで確定した結果、残る数値列が1つだけになれば単一符号付きとして確定する', () => {
    const rows = [
      ['取引日', '入出金内容', '入出金額', '取引後残高'],
      ['2026/07/20', 'セブンイレブン', '-150', '9850'],
      ['2026/07/21', '給与振込', '250000', '259850'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.balanceColumn).toEqual([{ columnIndex: 3, headerName: '取引後残高' }])
    expect(draft.amountColumn).toEqual([{ columnIndex: 2, headerName: '入出金額' }])
    expect(draft.amountMode).toBe('single_signed')
    expect(draft.debitColumn).toEqual([])
    expect(draft.creditColumn).toEqual([])
  })

  it('金額列のヘッダーが「金額」を含まない場合でも、出金・入金列が同一列に絞り込まれただけでdebit_credit_splitと誤判定しない', () => {
    const rows = [
      ['取引日', '入出金内容', '入出金(円)', '取引後残高(円)'],
      ['2026/07/20', 'セブンイレブン', '-150', '9850'],
      ['2026/07/21', '給与振込', '250000', '259850'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.amountColumn).toEqual([{ columnIndex: 2, headerName: '入出金(円)' }])
    expect(draft.amountMode).toBe('single_signed')
  })
})

describe('label・formatGroupId・isSettled', () => {
  it('CSVの中身から推測せず常にnullのままにする', () => {
    const rows = [
      ['取引日', '摘要', '金額'],
      ['2026/07/20', 'セブンイレブン', '-150'],
    ]

    const draft = inferMappingDefinitionDraft(rows)

    expect(draft.label).toBeNull()
    expect(draft.formatGroupId).toBeNull()
    expect(draft.isSettled).toBeNull()
  })
})
