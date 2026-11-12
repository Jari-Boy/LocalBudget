import type { ReactNode } from 'react'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory, TreeSelectNode } from '../common/tree-select/treeSelectModel'
import type { JournalEditorMaster } from './JournalEntryEditor'
import {
  bulkEditRules,
  isBulkPickEmpty,
  sanitizeBulkPick,
  selectionStats,
  summarizeBulkEdit,
  type BulkChange,
  type BulkLabels,
  type BulkPick,
  type BulkSelectedLine,
} from './journalBulkEditModel'
import './JournalLineBulkBar.css'

export interface JournalLineBulkBarProps {
  /** 選択中の明細行(表示中の行だけ) */
  selected: readonly BulkSelectedLine[]
  /** 変える項目の選択。親が持つ。選べなくなった項目は、変更のたびにこの部品が「変更しない」に戻して通知する */
  pick: BulkPick
  onPickChange: (pick: BulkPick) => void
  master: JournalEditorMaster
  /** 適用の確認中(2回押しの2回目を待っている) */
  confirming: boolean
  onAskConfirm: () => void
  onCancelConfirm: () => void
  /** 確認中の「本当に更新する」 */
  onApply: () => void
  onClearSelection: () => void
  /** 保存中。適用を押せなくする */
  busy: boolean
}

/** 「なし(外す)」を表す選択ツリーの項目の値 */
const CLEAR_VALUE = '__clear'
const KEEP_LABEL = '変更しない'

/** 選択ツリーの先頭に「なし(外す)」の項目を足す(科目には外す操作はないので足さない) */
function withClearOption(categories: readonly TreeSelectCategory[]): TreeSelectCategory[] {
  return [{ key: '__bulk', name: '操作', nodes: [{ kind: 'item', value: CLEAR_VALUE, name: 'なし(外す)', isActive: true }] }, ...categories]
}

function findItemName(nodes: readonly TreeSelectNode[], value: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'item') {
      if (node.value === value) return node.name
    } else {
      const nested = findItemName(node.children, value)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function nameInCategories(categories: readonly TreeSelectCategory[], id: number): string {
  for (const category of categories) {
    const name = findItemName(category.nodes, String(id))
    if (name !== undefined) return name
  }
  return String(id)
}

function changeToValue(change: BulkChange<number>): string {
  return change.kind === 'keep' ? '' : change.kind === 'clear' ? CLEAR_VALUE : String(change.value)
}

function valueToChange(value: string): BulkChange<number> {
  return value === '' ? { kind: 'keep' } : value === CLEAR_VALUE ? { kind: 'clear' } : { kind: 'set', value: Number(value) }
}

const quote = (names: readonly string[]) => names.map((n) => `「${n}」`).join('')

/**
 * 一括編集バー(計画Issue #182)。明細行単位の表で明細の行を1行以上選ぶと、表の上に出る。変える項目
 * (科目・プロジェクト・取引先・精算バッチ・世帯メンバー)だけを選び、「変更しない」の項目はそのまま。
 * 取引先・精算バッチ・世帯メンバーは、選択した行(科目を変えるなら変更後の科目)に合わせて先に無効にし、
 * 理由を示す(不正な操作をできなくする)。選べなくなった項目の選択は自動で外す。適用は2回押して確定する
 * (1回目で件数と元に戻せない旨を示す確認を出す)。選択・編集内容・確認の状態と、実際の保存は呼び出し側が持つ。
 */
export function JournalLineBulkBar({
  selected,
  pick,
  onPickChange,
  master,
  confirming,
  onAskConfirm,
  onCancelConfirm,
  onApply,
  onClearSelection,
  busy,
}: JournalLineBulkBarProps) {
  const accountById = new Map(master.accounts.map((a) => [a.id, a]))
  const rules = bulkEditRules(selected, pick, accountById)
  const stats = selectionStats(selected)
  const labels: BulkLabels = {
    project: (id) => nameInCategories(master.projectCategories, id),
    counterparty: (id) => nameInCategories(master.counterpartyCategories, id),
    batch: (id) => master.batches.find((b) => b.id === id)?.name ?? String(id),
    member: (id) => master.members.find((m) => m.id === id)?.name ?? String(id),
  }
  const summary = summarizeBulkEdit(selected, pick, accountById, labels)
  const empty = isBulkPickEmpty(pick)

  /** 選び直したとき、選べなくなった項目の選択を外してから親へ伝える */
  const change = (patch: Partial<BulkPick>) => {
    const next = { ...pick, ...patch }
    onPickChange(sanitizeBulkPick(next, bulkEditRules(selected, next, accountById)))
  }

  /** 無効な項目の下に出す理由(選択が空のときは出さない) */
  const note = (allowed: boolean, text: string): ReactNode =>
    !allowed && selected.length > 0 ? <span className="journal-line-bulk__note">{text}</span> : null

  return (
    <section aria-label="一括編集" className="journal-line-bulk">
      <div className="journal-line-bulk__head">
        <strong className="journal-line-bulk__count">{`${stats.lineCount}行を選択中(借方 ${stats.debitCount}行・貸方 ${stats.creditCount}行、${stats.entryCount}件の仕訳)`}</strong>
        <button type="button" className="journal-line-bulk__button" onClick={onClearSelection}>
          選択を解除
        </button>
        <span className="journal-line-bulk__hint">
          変える項目だけ選びます。「{KEEP_LABEL}」の項目はそのままです。選べない項目は、選択した行の科目に合わせて先に無効になります。
        </span>
      </div>

      <div className="journal-line-bulk__fields">
        <div className="journal-line-bulk__field">
          <span className="journal-line-bulk__label">科目</span>
          <TreeSelect
            label="一括編集の科目"
            categories={master.accountCategories}
            value={pick.accountId === null ? '' : String(pick.accountId)}
            emptyLabel={KEEP_LABEL}
            placeholder={KEEP_LABEL}
            onChange={(v) => change({ accountId: v === '' ? null : Number(v) })}
          />
        </div>
        <div className="journal-line-bulk__field">
          <span className="journal-line-bulk__label">プロジェクト</span>
          <TreeSelect
            label="一括編集のプロジェクト"
            categories={withClearOption(master.projectCategories)}
            value={changeToValue(pick.project)}
            emptyLabel={KEEP_LABEL}
            placeholder={KEEP_LABEL}
            onChange={(v) => change({ project: valueToChange(v) })}
          />
        </div>
        <div className="journal-line-bulk__field">
          <span className="journal-line-bulk__label">取引先</span>
          <TreeSelect
            label="一括編集の取引先"
            categories={withClearOption(master.counterpartyCategories)}
            value={changeToValue(pick.counterparty)}
            emptyLabel={KEEP_LABEL}
            placeholder={KEEP_LABEL}
            disabled={!rules.counterpartyAllowed}
            onChange={(v) => change({ counterparty: valueToChange(v) })}
          />
          {note(
            rules.counterpartyAllowed,
            `取引先は費用・収益の科目の行にだけ付けられます(選択中: ${quote(rules.counterpartyBlockedBy)})。科目を費用・収益に変えると選べます`,
          )}
        </div>
        <div className="journal-line-bulk__field">
          <span className="journal-line-bulk__label">精算バッチ</span>
          <select
            className="journal-line-bulk__select"
            aria-label="一括編集の精算バッチ"
            value={changeToValue(pick.batch)}
            disabled={!rules.batchAllowed}
            onChange={(e) => change({ batch: valueToChange(e.target.value) })}
          >
            <option value="">{KEEP_LABEL}</option>
            <option value={CLEAR_VALUE}>なし(外す)</option>
            {master.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {note(
            rules.batchAllowed,
            `精算バッチは立替金・未払金の行にだけ付けられます(選択中: ${quote(rules.batchBlockedBy)})。科目を立替金・未払金に変えると選べます`,
          )}
        </div>
        <div className="journal-line-bulk__field">
          <span className="journal-line-bulk__label">世帯メンバー</span>
          <select
            className="journal-line-bulk__select"
            aria-label="一括編集の世帯メンバー"
            value={pick.memberId === null ? '' : String(pick.memberId)}
            disabled={!rules.memberAllowed}
            onChange={(e) => change({ memberId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{KEEP_LABEL}</option>
            {master.members
              .filter((m) => m.isActive)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          {note(rules.memberAllowed, `既定の世帯メンバーがある科目の行は、世帯メンバーを変えられません(${quote(rules.memberBlockedBy)})`)}
        </div>
      </div>

      <ul className="journal-line-bulk__summary">
        {summary.map((s) => (
          <li key={s.text} className={s.warn ? 'journal-line-bulk__summary--warn' : undefined}>
            {s.text}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div role="alert" className="journal-line-bulk__confirm">
          <strong className="journal-line-bulk__confirm-title">{`${stats.lineCount}行(${stats.entryCount}件の仕訳)を更新します。元に戻せません。`}</strong>
          <button type="button" className="journal-line-bulk__button" onClick={onCancelConfirm}>
            やめる
          </button>
          <button type="button" className="journal-line-bulk__button journal-line-bulk__button--danger" disabled={busy} onClick={onApply}>
            本当に更新する
          </button>
        </div>
      ) : (
        <div className="journal-line-bulk__actions">
          <button
            type="button"
            className="journal-line-bulk__button journal-line-bulk__button--primary"
            disabled={busy || empty || selected.length === 0}
            onClick={onAskConfirm}
          >
            {empty ? '適用' : `${stats.lineCount}行に適用`}
          </button>
        </div>
      )}
    </section>
  )
}
