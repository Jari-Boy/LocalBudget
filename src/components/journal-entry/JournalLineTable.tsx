import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../infrastructure/i18n/formatDate'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { SOURCE_TAGS } from '../common/journal-result/journalResultModel'
import { pairLinesBySide } from './journalLineTableModel'
import './JournalLineTable.css'

/** 表に出す名前の解決(ID → 表示名)。該当がなければ空文字を返す(科目だけは「不明」を返してよい) */
export interface JournalLineTableLookup {
  accountName: (id: number) => string
  projectName: (id: number) => string
  counterpartyName: (id: number) => string
  batchName: (id: number) => string
  memberName: (id: number) => string
}

export interface JournalLineTableProps {
  entries: readonly JournalEntry[]
  lookup: JournalLineTableLookup
  /** 選択中の仕訳。その仕訳のすべての行を強調する */
  selectedId: number | null
  /** どの行を押しても、その仕訳が選ばれる(選択は仕訳単位) */
  onSelect: (entryId: number) => void
  /** 先頭行の「編集」ボタン。その仕訳のインライン編集を始める */
  onEdit: (entryId: number) => void
}

/** 借方・貸方それぞれの列(科目・プロジェクト・取引先・精算バッチ・世帯メンバー・金額) */
const SIDE_COLUMNS = ['科目', 'プロジェクト', '取引先', '精算バッチ', '世帯メンバー', '金額'] as const

function toDate(entryDate: string): Date {
  const [year, month, day] = entryDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * 仕訳一覧の「明細行単位」の表(計画Issue #182)。借方の明細行を左・貸方の明細行を右に、行番号で
 * 対応づけて並べる(複合仕訳は行が増え、足りない側は空欄)。日付・出どころ・摘要・コメントは
 * 仕訳の先頭行だけに出し、仕訳の境目は区切り線で分ける(仕訳ごとに tbody を分ける)。どの行を
 * 押しても選択は仕訳単位。幅が足りないときは、表を囲む枠が横スクロールする。
 * 表示用の名前解決(lookup)とJournalEntryだけを受け取り、DB・Repositoryには依存しない。
 */
export function JournalLineTable({ entries, lookup, selectedId, onSelect, onEdit }: JournalLineTableProps) {
  if (entries.length === 0) {
    return <p className="journal-line-table__empty">該当する仕訳がありません</p>
  }

  const sideCells = (line: JournalLine | null, currency: string, creditStart: boolean) => {
    const text = (value: string | undefined) => value ?? ''
    const values = [
      line === null ? '' : lookup.accountName(line.accountId),
      line?.projectId == null ? '' : text(lookup.projectName(line.projectId)),
      line?.counterpartyId == null ? '' : text(lookup.counterpartyName(line.counterpartyId)),
      line?.settlementBatchId == null ? '' : text(lookup.batchName(line.settlementBatchId)),
      line === null ? '' : lookup.memberName(line.householdMemberId),
      line === null ? '' : formatCurrency(line.amount, currency),
    ]
    return values.map((value, i) => (
      <td
        key={SIDE_COLUMNS[i]}
        className={[
          'journal-line-table__cell',
          i === 0 ? 'journal-line-table__cell--account' : '',
          i === 0 && creditStart ? 'journal-line-table__cell--credit-start' : '',
          i === SIDE_COLUMNS.length - 1 ? 'journal-line-table__cell--amount' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </td>
    ))
  }

  return (
    <div className="journal-line-table">
      <table className="journal-line-table__table" aria-label="仕訳の明細行">
        <colgroup>
          <col className="journal-line-table__col-date" />
          <col className="journal-line-table__col-source" />
          <col className="journal-line-table__col-memo" />
          <col className="journal-line-table__col-comment" />
          {[0, 1].flatMap((side) =>
            SIDE_COLUMNS.map((name) => <col key={`${side}-${name}`} className={`journal-line-table__col-${name === '金額' ? 'amount' : 'attr'}`} />),
          )}
        </colgroup>
        <thead>
          <tr className="journal-line-table__group-head">
            <td colSpan={4} />
            <th colSpan={SIDE_COLUMNS.length} scope="colgroup">
              借方
            </th>
            <th colSpan={SIDE_COLUMNS.length} scope="colgroup" className="journal-line-table__credit-start">
              貸方
            </th>
          </tr>
          <tr>
            {['日付', '出どころ', '摘要', 'コメント'].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
            {[0, 1].flatMap((side) =>
              SIDE_COLUMNS.map((name, i) => (
                <th
                  key={`${side}-${name}`}
                  scope="col"
                  className={[
                    i === 0 && side === 1 ? 'journal-line-table__credit-start' : '',
                    name === '金額' ? 'journal-line-table__cell--amount' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {name}
                </th>
              )),
            )}
          </tr>
        </thead>
        {entries.map((entry) => {
          const tag = SOURCE_TAGS[entry.sourceType]
          const memo = entry.memo !== null && entry.memo !== '' ? entry.memo : '(摘要なし)'
          const selected = entry.id === selectedId
          return (
            <tbody key={entry.id} data-entry-id={entry.id}>
              {pairLinesBySide(entry.lines).map((pair, index) => (
                <tr
                  key={index}
                  className={selected ? 'journal-line-table__row--selected' : undefined}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(entry.id)}
                >
                  <td className="journal-line-table__cell">{index === 0 ? formatDate(toDate(entry.entryDate)) : ''}</td>
                  <td className="journal-line-table__cell">
                    {index === 0 && (
                      <span className="journal-line-table__tag" style={{ background: tag.bg, color: tag.fg }}>
                        {tag.label}
                      </span>
                    )}
                  </td>
                  <td className="journal-line-table__cell">
                    {index === 0 && (
                      <span className="journal-line-table__memo-cell">
                        <button type="button" className="journal-line-table__memo">
                          {memo}
                        </button>
                        <button
                          type="button"
                          className="journal-line-table__edit"
                          aria-label={`${memo}を編集`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit(entry.id)
                          }}
                        >
                          編集
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="journal-line-table__cell journal-line-table__comment">{index === 0 ? (entry.comment ?? '') : ''}</td>
                  {sideCells(pair.debit, entry.currency, false)}
                  {sideCells(pair.credit, entry.currency, true)}
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
