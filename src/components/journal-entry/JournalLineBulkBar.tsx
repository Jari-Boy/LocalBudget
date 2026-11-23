import { useState, type ReactNode } from 'react'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '../common/confirm-dialog/ConfirmDialog'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { BatchSelect } from '../master/BatchSelect'
import { MemberSelect } from '../master/MemberSelect'
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
  /** 渡すと、精算バッチの選択欄に「+ 新しいバッチ」を出す(計画Issue #269) */
  onCreateBatch?: (name: string) => Promise<SettlementBatch>
}

/** 「なし(外す)」を表す選択ツリーの項目の値 */
const CLEAR_VALUE = '__clear'
const KEEP_LABEL = '変更しない'
/** バーの2行目に小さく出す案内(長いときは省略して、全文はマウスを載せると出る) */
const HINT = '選択中は、行を押してもチェックを切り替えられます(Esc でも解除できます)'
/** 一括編集の精算バッチで、「変更しない」の次に固定して出す「なし(外す)」。参照を安定させるため定数にする */
const CLEAR_OPTIONS = [{ value: CLEAR_VALUE, label: 'なし(外す)' }]

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

/**
 * 一括編集バー(計画Issue #182)。明細行単位の表で明細の行を1行以上選ぶと、表の上(画面の上部に固定された領域)に出る。
 * 変える項目だけを選び、「変更しない」の項目はそのまま。固定領域を高くしないため(計画Issue #266)、1行にまとめる:
 * 科目と取引先は常に出し、プロジェクト・精算バッチ・世帯メンバーは「その他の項目」を開くと下に重ねて出す
 * (表を押し下げない。変えている項目があると、閉じていても「その他の項目」に件数が出る)。適用の確認は、バーの中ではなくダイアログで出す。
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
  onCreateBatch,
}: JournalLineBulkBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const accountById = new Map(master.accounts.map((a) => [a.id, a]))
  const rules = bulkEditRules(selected, pick, accountById)
  const stats = selectionStats(selected)
  const labels: BulkLabels = {
    project: (id) => nameInCategories(master.projectCategories, id),
    counterparty: (id) => nameInCategories(master.counterpartyCategories, id),
    batch: (id) => master.batches.find((b) => b.id === id)?.name ?? String(id),
    member: (id) => master.members.find((m) => m.id === id)?.name ?? String(id),
  }
  /** 科目を変えて取引先・精算バッチが外れる行があるときの警告。確認のときだけ出す */
  const warnings = summarizeBulkEdit(selected, pick, accountById, labels).filter((s) => s.warn)
  const empty = isBulkPickEmpty(pick)
  /** 「その他の項目」に畳まれた項目のうち、変えているものの数 */
  const moreChangedCount = [pick.project.kind !== 'keep', pick.batch.kind !== 'keep', pick.memberId !== null].filter(Boolean).length
  const moreLabel = moreChangedCount > 0 ? `その他の項目(${moreChangedCount}件変更中)` : 'その他の項目'

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
      <div className="journal-line-bulk__row">
        <div className="journal-line-bulk__summary">
          <strong className="journal-line-bulk__count">{`${stats.lineCount}行を選択中(借方 ${stats.debitCount}行・貸方 ${stats.creditCount}行、${stats.entryCount}件の仕訳)`}</strong>
          <span className="journal-line-bulk__hint" title={HINT}>
            {HINT}
          </span>
        </div>

        <div className="journal-line-bulk__field">
          <TreeSelect
            label="一括編集の科目"
            categories={master.accountCategories}
            favoriteKind="account"
            value={pick.accountId === null ? '' : String(pick.accountId)}
            emptyLabel={KEEP_LABEL}
            placeholder={KEEP_LABEL}
            onChange={(v) => change({ accountId: v === '' ? null : Number(v) })}
          />
        </div>
        <div className="journal-line-bulk__field">
          <TreeSelect
            label="一括編集の取引先"
            categories={withClearOption(master.counterpartyCategories)}
            favoriteKind="counterparty"
            value={changeToValue(pick.counterparty)}
            emptyLabel={KEEP_LABEL}
            placeholder={KEEP_LABEL}
            disabled={!rules.counterpartyAllowed}
            onChange={(v) => change({ counterparty: valueToChange(v) })}
          />
          {note(rules.counterpartyAllowed, '費用・収益の行のみ')}
        </div>

        <button
          type="button"
          className="journal-line-bulk__button"
          aria-label={moreLabel}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          {`その他の項目${moreChangedCount > 0 ? `(${moreChangedCount})` : ''} ${moreOpen ? '▴' : '▾'}`}
        </button>

        <span className="journal-line-bulk__spacer" />
        <button type="button" className="journal-line-bulk__button" onClick={onClearSelection}>
          選択を解除
        </button>
        <button
          type="button"
          className="journal-line-bulk__button journal-line-bulk__button--primary"
          disabled={busy || empty || selected.length === 0}
          onClick={onAskConfirm}
        >
          {empty ? '適用' : `${stats.lineCount}行に適用`}
        </button>
      </div>

      {moreOpen && (
        <div className="journal-line-bulk__more">
          <div className="journal-line-bulk__field journal-line-bulk__field--labeled">
            <span className="journal-line-bulk__label">プロジェクト</span>
            <TreeSelect
              label="一括編集のプロジェクト"
              categories={withClearOption(master.projectCategories)}
              favoriteKind="project"
              value={changeToValue(pick.project)}
              emptyLabel={KEEP_LABEL}
              placeholder={KEEP_LABEL}
              onChange={(v) => change({ project: valueToChange(v) })}
            />
          </div>
          <div className="journal-line-bulk__field journal-line-bulk__field--labeled">
            <span className="journal-line-bulk__label">精算バッチ</span>
            <BatchSelect
              label="一括編集の精算バッチ"
              batches={master.batches}
              value={changeToValue(pick.batch)}
              emptyLabel={KEEP_LABEL}
              leadingOptions={CLEAR_OPTIONS}
              disabled={!rules.batchAllowed}
              onCreateBatch={onCreateBatch}
              onChange={(v) => change({ batch: valueToChange(v) })}
            />
            {note(rules.batchAllowed, '未収金・未払金(精算バッチ)の行のみ')}
          </div>
          <div className="journal-line-bulk__field journal-line-bulk__field--labeled">
            <span className="journal-line-bulk__label">世帯メンバー</span>
            <MemberSelect
              label="一括編集の世帯メンバー"
              members={master.members}
              value={pick.memberId === null ? '' : String(pick.memberId)}
              emptyLabel={KEEP_LABEL}
              disabled={!rules.memberAllowed}
              onChange={(value) => change({ memberId: value === '' ? null : Number(value) })}
            />
            {note(rules.memberAllowed, '既定メンバーのある科目は不可')}
          </div>
        </div>
      )}

      {confirming &&
        // 確認はダイアログで出す。固定バーの重なり順(スタッキング)の外に出すため body に描く
        createPortal(
          <ConfirmDialog
            title="一括編集の確認"
            message={
              <>
                {`${stats.lineCount}行(${stats.entryCount}件の仕訳)を更新します。元に戻せません。`}
                {warnings.map((w) => (
                  <span key={w.text} className="journal-line-bulk__note journal-line-bulk__note--block">
                    {w.text}
                  </span>
                ))}
              </>
            }
            confirmLabel="本当に更新する"
            cancelLabel="やめる"
            busy={busy}
            onConfirm={onApply}
            onCancel={onCancelConfirm}
          />,
          document.body,
        )}
    </section>
  )
}
