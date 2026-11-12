import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import type { JournalEntryFormLine } from './journalEntryFormLine'
import { followBookkeeper } from './journalEditorMember'
import { JournalLinesEditor } from './JournalLinesEditor'
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
  /** true のとき、科目・取引先・プロジェクト・世帯メンバーと行の追加・削除を編集できない(金額・摘要・コメントは編集できる) */
  readOnlyLines?: boolean
  /**
   * true のとき、取引日と起票者を編集できない(定期仕訳の確認パネル。取引日はルールの期日で決まり、起票者は
   * ルールか確認パネルの専用欄で決める)。科目・金額・行の追加・削除は、承認待ちの定期仕訳でも編集できる(計画Issue #180)
   */
  lockEntryDate?: boolean
  /** 渡すと、精算バッチの選択肢に「+ 新しいバッチ」を出す。名前を受けて作成したバッチを返す */
  onCreateBatch?: (name: string) => Promise<SettlementBatch>
  /** 渡すと、取引先の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ取引先のIDを渡す */
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
  /** 渡すと、プロジェクトの選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へプロジェクトのIDを渡す */
  onRequestCreateProject?: (apply: (id: number) => void) => void
  /** 渡すと、科目の選択ツリーに「+ 新規追加」を出す。作成後に呼ぶ apply へ科目のIDを渡す(計画Issue #180) */
  onRequestCreateAccount?: (apply: (id: number) => void) => void
}

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
  lockEntryDate = false,
  onCreateBatch,
  onRequestCreateCounterparty,
  onRequestCreateProject,
  onRequestCreateAccount,
}: JournalEntryEditorProps) {
  const accountById = new Map(master.accounts.map((a) => [a.id, a]))

  const update = (patch: Partial<JournalEditorValue>) => onChange({ ...value, ...patch })

  const defaultMemberOf = (accountId: number | null): number | null =>
    accountId === null ? null : (accountById.get(accountId)?.householdMemberId ?? null)

  /** 起票者を変えたとき、手で変えていない行の世帯メンバーを追従させる */
  const changeBookkeeper = (next: number | null) =>
    update({
      householdMemberId: next,
      lines: [...followBookkeeper(value.lines, defaultMemberOf, value.householdMemberId, next)],
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
            disabled={lockEntryDate}
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
            disabled={lockEntryDate}
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

      <JournalLinesEditor
        lines={value.lines}
        onChange={(lines) => update({ lines })}
        master={master}
        bookkeeperId={value.householdMemberId}
        readOnlyLines={readOnlyLines}
        onCreateBatch={onCreateBatch}
        onRequestCreateCounterparty={onRequestCreateCounterparty}
        onRequestCreateProject={onRequestCreateProject}
        onRequestCreateAccount={onRequestCreateAccount}
      />
    </div>
  )
}
