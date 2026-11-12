import { useState } from 'react'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import {
  createEmptyJournalEntryFormLine,
  isCounterpartyEligibleCategory,
  type JournalEntryFormLine,
} from './journalEntryFormLine'
import { followBookkeeper, memberAfterAccountChange } from './journalEditorMember'
import { summarizeBalance } from './journalScreenModel'
import './JournalEntryEditor.css'

export interface JournalEditorLine {
  key: number
  line: JournalEntryFormLine
}

/** 詳細パネルで編集中の仕訳(確定済み・下書き・新規・提案で共通) */
export interface JournalEditorValue {
  entryDate: string
  memo: string
  comment: string
  /** 起票者。変えると、手で変えていない明細行の世帯メンバーが追従する(計画Issue #169) */
  householdMemberId: number | null
  lines: JournalEditorLine[]
}

export interface JournalEditorMaster {
  accounts: readonly Account[]
  accountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  members: readonly HouseholdMember[]
  batches: readonly SettlementBatch[]
}

export interface JournalEntryEditorProps {
  value: JournalEditorValue
  onChange: (value: JournalEditorValue) => void
  master: JournalEditorMaster
  /**
   * true のとき、金額・摘要・コメント以外は編集できない(定期取引の提案)。取引日・起票者・科目・
   * 各行の2段目(取引先・プロジェクト・世帯メンバー)は読み取り専用で表示し、行の追加・削除ボタンは
   * 無効で表示する(計画Issue #164)
   */
  readOnlyLines?: boolean
  /** 渡すと、精算バッチの選択肢に「+ 新しいバッチ」を出す。名前を受けて作成したバッチを返す */
  onCreateBatch?: (name: string) => Promise<SettlementBatch>
  /** 渡すと、取引先の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ取引先のIDを渡す */
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
}

const SIDES: { side: JournalLineSide; label: string }[] = [
  { side: 'debit', label: '借方' },
  { side: 'credit', label: '貸方' },
]

/**
 * 仕訳の詳細パネルの編集部分(計画Issue #152)。取引日・摘要・起票者・コメントと、借方・貸方の2列の
 * 明細を編集する。1行目に科目・金額・削除、2行目に取引先(費用・収益のみ)・精算バッチ(システム管理の
 * 立替金・未払金のみ)・プロジェクト・世帯メンバーを置く。明細行の世帯メンバーは常に1人を選び、既定値は
 * 起票者、科目に既定メンバーがある行はその既定値で固定する(計画Issue #169)。精算バッチのタグは行に保持され、編集しても落ちない
 * (計画Issue #144)。貸借の合計と差額は入力支援で、正式な検証はRepositoryが行う
 * (docs/architecture.md 12章)。保存などの操作ボタンと関連仕訳は、呼び出し側(JournalScreen)が置く。
 */
export function JournalEntryEditor({
  value,
  onChange,
  master,
  readOnlyLines = false,
  onCreateBatch,
  onRequestCreateCounterparty,
}: JournalEntryEditorProps) {
  const [creatingBatchKey, setCreatingBatchKey] = useState<number | null>(null)
  const [newBatchName, setNewBatchName] = useState('')
  const accountById = new Map(master.accounts.map((a) => [a.id, a]))
  const memberById = new Map(master.members.map((m) => [m.id, m]))
  const balance = summarizeBalance(value.lines.map((l) => l.line))

  const update = (patch: Partial<JournalEditorValue>) => onChange({ ...value, ...patch })
  const updateLine = (key: number, change: (line: JournalEntryFormLine) => JournalEntryFormLine) =>
    update({ lines: value.lines.map((l) => (l.key === key ? { key, line: change(l.line) } : l)) })

  const defaultMemberOf = (accountId: number | null): number | null =>
    accountId === null ? null : (accountById.get(accountId)?.householdMemberId ?? null)

  const addLine = (side: JournalLineSide) => {
    const key = value.lines.reduce((max, l) => Math.max(max, l.key), 0) + 1
    update({
      lines: [
        ...value.lines,
        { key, line: { ...createEmptyJournalEntryFormLine(), side, householdMemberId: value.householdMemberId } },
      ],
    })
  }

  /** 起票者を変えたとき、手で変えていない行の世帯メンバーを追従させる */
  const changeBookkeeper = (next: number | null) =>
    update({
      householdMemberId: next,
      lines: [...followBookkeeper(value.lines, defaultMemberOf, value.householdMemberId, next)],
    })

  /** 科目を変えたとき、その科目では持てない取引先・精算バッチ・メンバーの指定を外す */
  const changeAccount = (key: number, accountId: number | null) =>
    updateLine(key, (line) => {
      const account = accountId === null ? undefined : accountById.get(accountId)
      return {
        ...line,
        accountId,
        counterpartyId: account !== undefined && isCounterpartyEligibleCategory(account.category) ? line.counterpartyId : null,
        settlementBatchId: account !== undefined && isSettlementBatchTaggableAccount(account) ? line.settlementBatchId : null,
        householdMemberId: memberAfterAccountChange({
          line,
          newAccountDefault: account?.householdMemberId ?? null,
          previousAccountDefault: defaultMemberOf(line.accountId),
          entryMemberId: value.householdMemberId,
        }),
      }
    })

  /** 選べる世帯メンバー。無効なメンバーは、いま選ばれている場合だけ残す */
  const memberOptions = (selectedId: number | null) =>
    master.members
      .filter((m) => m.isActive || m.id === selectedId)
      .map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))

  const createBatch = async (key: number) => {
    if (onCreateBatch === undefined || newBatchName.trim() === '') return
    const created = await onCreateBatch(newBatchName.trim())
    updateLine(key, (line) => ({ ...line, settlementBatchId: created.id }))
    setCreatingBatchKey(null)
    setNewBatchName('')
  }

  return (
    <div className="journal-editor">
      <div className="journal-editor__head">
        <div className="journal-editor__field journal-editor__field--date">
          <label className="journal-editor__label" htmlFor="journal-editor-date">
            取引日
          </label>
          <input
            id="journal-editor-date"
            type="date"
            className="journal-editor__control"
            value={value.entryDate}
            disabled={readOnlyLines}
            onChange={(e) => update({ entryDate: e.target.value })}
          />
        </div>
        <div className="journal-editor__field journal-editor__field--memo">
          <label className="journal-editor__label" htmlFor="journal-editor-memo">
            摘要(任意)
          </label>
          <input
            id="journal-editor-memo"
            className="journal-editor__control"
            value={value.memo}
            onChange={(e) => update({ memo: e.target.value })}
          />
        </div>
        <div className="journal-editor__field journal-editor__field--bookkeeper">
          <label className="journal-editor__label" htmlFor="journal-editor-bookkeeper">
            起票者
          </label>
          <select
            id="journal-editor-bookkeeper"
            className="journal-editor__control"
            value={value.householdMemberId === null ? '' : String(value.householdMemberId)}
            disabled={readOnlyLines}
            onChange={(e) => changeBookkeeper(e.target.value === '' ? null : Number(e.target.value))}
          >
            {value.householdMemberId === null && <option value="">選択してください</option>}
            {memberOptions(value.householdMemberId)}
          </select>
        </div>
        <div className="journal-editor__field journal-editor__field--comment">
          <label className="journal-editor__label" htmlFor="journal-editor-comment">
            コメント(任意)
          </label>
          <textarea
            id="journal-editor-comment"
            className="journal-editor__control journal-editor__textarea"
            rows={2}
            value={value.comment}
            onChange={(e) => update({ comment: e.target.value })}
          />
        </div>
      </div>

      <div className="journal-editor__columns">
        {SIDES.map(({ side, label }) => {
          const rows = value.lines.filter((l) => l.line.side === side)
          const total = side === 'debit' ? balance.debitTotal : balance.creditTotal
          return (
            <section key={side} role="group" aria-label={label} className="journal-editor__column">
              <header className="journal-editor__column-head">
                <span>{label}</span>
                <span className="journal-editor__amount-text">{formatCurrency(total, 'JPY')}</span>
              </header>
              {rows.map(({ key, line }) => {
                const account = line.accountId === null ? undefined : accountById.get(line.accountId)
                const accountName = account?.name
                const defaultMember = account?.householdMemberId == null ? undefined : memberById.get(account.householdMemberId)
                return (
                  <div key={key} className="journal-editor__line">
                    <div className="journal-editor__line-main">
                      <div className="journal-editor__grow">
                        {readOnlyLines ? (
                          <span className="journal-editor__static">{accountName ?? '未選択'}</span>
                        ) : (
                          <TreeSelect
                            label="科目"
                            categories={master.accountCategories}
                            value={line.accountId === null ? '' : String(line.accountId)}
                            placeholder="未選択"
                            onChange={(v) => changeAccount(key, v === '' ? null : Number(v))}
                          />
                        )}
                      </div>
                      <input
                        className="journal-editor__control journal-editor__amount"
                        inputMode="numeric"
                        aria-label={accountName ? `${accountName}の金額` : '金額'}
                        value={line.amountInput}
                        onChange={(e) => updateLine(key, (l) => ({ ...l, amountInput: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="journal-editor__icon-button"
                        aria-label={accountName ? `${accountName}の行を削除` : '行を削除'}
                        disabled={readOnlyLines || rows.length <= 1}
                        onClick={() => update({ lines: value.lines.filter((l) => l.key !== key) })}
                      >
                        ×
                      </button>
                    </div>
                    <div className="journal-editor__line-sub">
                      {account !== undefined && isCounterpartyEligibleCategory(account.category) && (
                        <div className="journal-editor__sub-field">
                          <TreeSelect
                            label="取引先"
                            categories={master.counterpartyCategories}
                            value={line.counterpartyId === null ? '' : String(line.counterpartyId)}
                            emptyLabel="取引先なし"
                            placeholder="取引先なし"
                            disabled={readOnlyLines}
                            onChange={(v) => updateLine(key, (l) => ({ ...l, counterpartyId: v === '' ? null : Number(v) }))}
                            onCreate={
                              onRequestCreateCounterparty === undefined
                                ? undefined
                                : () =>
                                    onRequestCreateCounterparty((id) =>
                                      updateLine(key, (l) => ({ ...l, counterpartyId: id })),
                                    )
                            }
                          />
                        </div>
                      )}
                      {account !== undefined && isSettlementBatchTaggableAccount(account) && (
                        <select
                          className="journal-editor__control journal-editor__select"
                          aria-label="精算バッチ"
                          disabled={readOnlyLines}
                          value={line.settlementBatchId == null ? '' : String(line.settlementBatchId)}
                          onChange={(e) => {
                            if (e.target.value === 'new') {
                              setCreatingBatchKey(key)
                              return
                            }
                            updateLine(key, (l) => ({
                              ...l,
                              settlementBatchId: e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }}
                        >
                          <option value="">精算バッチなし</option>
                          {master.batches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                          {onCreateBatch !== undefined && <option value="new">+ 新しいバッチ</option>}
                        </select>
                      )}
                      <div className="journal-editor__sub-field">
                        <TreeSelect
                          label="プロジェクト"
                          categories={master.projectCategories}
                          value={line.projectId === null ? '' : String(line.projectId)}
                          emptyLabel="プロジェクトなし"
                          placeholder="プロジェクトなし"
                          disabled={readOnlyLines}
                          onChange={(v) => updateLine(key, (l) => ({ ...l, projectId: v === '' ? null : Number(v) }))}
                        />
                      </div>
                      {defaultMember !== undefined && line.householdMemberId === defaultMember.id ? (
                        <span className="journal-editor__locked">{defaultMember.name}(科目の既定)</span>
                      ) : (
                        <select
                          className="journal-editor__control journal-editor__select"
                          aria-label="世帯メンバー"
                          disabled={readOnlyLines}
                          value={line.householdMemberId === null ? '' : String(line.householdMemberId)}
                          onChange={(e) =>
                            updateLine(key, (l) => ({
                              ...l,
                              householdMemberId: e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }
                        >
                          {line.householdMemberId === null && <option value="">選択してください</option>}
                          {defaultMember === undefined ? (
                            memberOptions(line.householdMemberId)
                          ) : (
                            // 科目の既定メンバーを後から変えて、旧メンバーのまま残した行。旧メンバーのまま保存するか、既定値にだけ変えられる
                            [line.householdMemberId, defaultMember.id].map((id) => (
                              <option key={id} value={id ?? ''}>
                                {id === defaultMember.id
                                  ? `${defaultMember.name}(科目の既定)`
                                  : (memberById.get(id ?? -1)?.name ?? '')}
                              </option>
                            ))
                          )}
                        </select>
                      )}
                    </div>
                    {creatingBatchKey === key && (
                      <div className="journal-editor__line-sub">
                        <input
                          className="journal-editor__control"
                          aria-label="新しい精算バッチの名前"
                          value={newBatchName}
                          autoFocus
                          onChange={(e) => setNewBatchName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="journal-editor__small-button"
                          disabled={newBatchName.trim() === ''}
                          onClick={() => void createBatch(key)}
                        >
                          バッチを作成
                        </button>
                        <button type="button" className="journal-editor__small-button" onClick={() => setCreatingBatchKey(null)}>
                          やめる
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              <button type="button" className="journal-editor__add" disabled={readOnlyLines} onClick={() => addLine(side)}>
                {`+ ${label}の行を追加`}
              </button>
            </section>
          )
        })}
      </div>

      <div
        role="status"
        className={`journal-editor__balance${balance.isBalanced ? '' : ' journal-editor__balance--off'}`}
      >
        {balance.isBalanced ? '貸借一致' : `差額 ${formatCurrency(balance.difference, 'JPY')}`}
      </div>
    </div>
  )
}
