import { useState } from 'react'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { createEmptyJournalEntryFormLine, isCounterpartyEligibleCategory, type JournalEntryFormLine } from './journalEntryFormLine'
import { memberAfterAccountChange } from './journalEditorMember'
import { summarizeBalance } from './journalScreenModel'
import type { JournalEditorLine, JournalEditorMaster } from './JournalEntryEditor'
import './JournalEntryEditor.css'

export interface JournalLinesEditorProps {
  lines: JournalEditorLine[]
  onChange: (lines: JournalEditorLine[]) => void
  master: JournalEditorMaster
  /**
   * 起票者。行の世帯メンバーの既定値になる。null(未決定)のこともある(定期仕訳のルールで起票者を
   * 決めないとき)
   */
  bookkeeperId: number | null
  /** true のとき、科目・取引先・プロジェクト・世帯メンバーと行の追加・削除は編集できない(金額だけ編集できる) */
  readOnlyLines?: boolean
  /**
   * 渡すと、世帯メンバーの選択肢に「未指定」の項目をこの名前で常に出す(定期仕訳のルール。行で決めない
   * ときは、確定時に 科目の既定メンバー > 起票者 の順で決まる)。省略時は、未指定の行にだけ「選択してください」を出す
   */
  memberNoneLabel?: string
  /** 渡すと、精算バッチの選択肢に「+ 新しいバッチ」を出す。名前を受けて作成したバッチを返す */
  onCreateBatch?: (name: string) => Promise<SettlementBatch>
  /** 渡すと、取引先の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ取引先のIDを渡す */
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
  /** 渡すと、プロジェクトの選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へプロジェクトのIDを渡す(計画Issue #180) */
  onRequestCreateProject?: (apply: (id: number) => void) => void
  /** 渡すと、科目の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ科目のIDを渡す(計画Issue #180) */
  onRequestCreateAccount?: (apply: (id: number) => void) => void
}

const SIDES: { side: JournalLineSide; label: string }[] = [
  { side: 'debit', label: '借方' },
  { side: 'credit', label: '貸方' },
]

/**
 * 借方・貸方の2列の行編集と貸借一致の表示(計画Issue #180で、仕訳エディタから共通部品として切り出した)。
 * 仕訳の起票・編集(JournalEntryEditor)、定期仕訳ルールの作成・編集、承認待ちの定期仕訳の確認パネルが
 * 同じ部品を使う。1行目に科目・金額・削除、2行目に取引先(費用・収益のみ)・精算バッチ(システム管理の
 * 立替金・未払金のみ)・プロジェクト・世帯メンバーを置く。世帯メンバーは常に1人を選び、既定値は起票者、
 * 科目に既定メンバーがある行はその既定値で固定する(計画Issue #169)。精算バッチのタグは行に保持され、
 * 編集しても落ちない(計画Issue #144)。貸借の合計と差額は入力支援で、正式な検証は保存側が行う。
 */
export function JournalLinesEditor({
  lines,
  onChange,
  master,
  bookkeeperId,
  readOnlyLines = false,
  memberNoneLabel,
  onCreateBatch,
  onRequestCreateCounterparty,
  onRequestCreateProject,
  onRequestCreateAccount,
}: JournalLinesEditorProps) {
  const [creatingBatchKey, setCreatingBatchKey] = useState<number | null>(null)
  const [newBatchName, setNewBatchName] = useState('')
  const accountById = new Map(master.accounts.map((a) => [a.id, a]))
  const memberById = new Map(master.members.map((m) => [m.id, m]))
  const balance = summarizeBalance(lines.map((l) => l.line))

  const updateLine = (key: number, change: (line: JournalEntryFormLine) => JournalEntryFormLine) =>
    onChange(lines.map((l) => (l.key === key ? { key, line: change(l.line) } : l)))

  const addLine = (side: JournalLineSide) => {
    const key = lines.reduce((max, l) => Math.max(max, l.key), 0) + 1
    onChange([...lines, { key, line: { ...createEmptyJournalEntryFormLine(), side, householdMemberId: bookkeeperId } }])
  }

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
          previousAccountDefault: line.accountId === null ? null : (accountById.get(line.accountId)?.householdMemberId ?? null),
          entryMemberId: bookkeeperId,
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
    <>
      <div className="journal-editor__columns">
        {SIDES.map(({ side, label }) => {
          const rows = lines.filter((l) => l.line.side === side)
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
                            onCreate={
                              onRequestCreateAccount === undefined
                                ? undefined
                                : () => onRequestCreateAccount((id) => changeAccount(key, id))
                            }
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
                        onClick={() => onChange(lines.filter((l) => l.key !== key))}
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
                          onCreate={
                            onRequestCreateProject === undefined
                              ? undefined
                              : () => onRequestCreateProject((id) => updateLine(key, (l) => ({ ...l, projectId: id })))
                          }
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
                          {(line.householdMemberId === null || memberNoneLabel !== undefined) && (
                            <option value="">{memberNoneLabel ?? '選択してください'}</option>
                          )}
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
    </>
  )
}
