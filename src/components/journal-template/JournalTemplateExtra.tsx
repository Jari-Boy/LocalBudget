import { useEffect, useRef, useState } from 'react'
import type { JournalTemplate, UpdateJournalTemplateInput } from '../../domain/journal-template/JournalTemplate'
import type { JournalEditorMaster } from '../journal-entry/JournalEntryEditor'
import { JournalLinesEditor } from '../journal-entry/JournalLinesEditor'
import type { LeafFormState } from '../master/GroupedMasterTab'
import {
  buildTemplateUpdateInput,
  isTemplateFormDirty,
  templateFormFromTemplate,
  validateTemplateForm,
  type JournalTemplateForm,
} from './journalTemplateForm'
import '../journal-entry/JournalEntryEditor.css'
import '../master/master.css'

export interface JournalTemplateExtraProps {
  template: JournalTemplate
  master: JournalEditorMaster
  /** 右パネルの「保存」「未保存の警告」と連動するため、フォームの状態を親へ渡す */
  setFormState: (state: LeafFormState | null) => void
  /** 摘要・起票者・明細行を保存する(名称・グループ・並び順は一覧側が扱う) */
  save: (input: UpdateJournalTemplateInput) => Promise<void>
}

/**
 * テンプレートの右パネルに出す、摘要・起票者・明細行のフォーム(計画Issue #201)。行の編集部品は
 * 仕訳の起票・定期仕訳と共通のJournalLinesEditorで、金額は空欄にできる(allowBlankAmounts。空欄の行は起票時に入力する)。
 * フォームの内容・保存できるか・保存の処理を、変わるたびに親(GroupedMasterTab)へ渡し、親の「保存」と
 * 未保存の警告が名称と一緒に扱う。世帯メンバーの「起票者と同じ」は、行で決めない(null)を表す。
 */
export function JournalTemplateExtra({ template, master, setFormState, save }: JournalTemplateExtraProps) {
  const [form, setForm] = useState<JournalTemplateForm>(() => templateFormFromTemplate(template))
  const saveRef = useRef(save)
  saveRef.current = save
  const formRef = useRef(form)
  formRef.current = form

  const validation = validateTemplateForm(form)
  const dirty = isTemplateFormDirty(form, template)
  const valid = validation.valid
  const reason = validation.valid ? undefined : validation.reason

  useEffect(() => {
    setFormState({
      dirty,
      valid,
      reason,
      save: () => saveRef.current(buildTemplateUpdateInput(formRef.current)),
    })
  }, [dirty, valid, reason, setFormState])

  const activeMembers = master.members.filter((m) => m.isActive || m.id === form.bookkeeperId)

  return (
    <>
      <div className="journal-editor__head">
        <div className="journal-editor__field journal-editor__field--memo">
          <label className="journal-editor__label" htmlFor="journal-template-memo">
            摘要(任意。起票時の初期値)
          </label>
          <input
            id="journal-template-memo"
            className="journal-editor__control"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
        </div>
        <div className="journal-editor__field journal-editor__field--bookkeeper">
          <label className="journal-editor__label" htmlFor="journal-template-bookkeeper">
            起票者
          </label>
          <select
            id="journal-template-bookkeeper"
            className="journal-editor__control"
            value={form.bookkeeperId === null ? '' : String(form.bookkeeperId)}
            onChange={(e) => setForm({ ...form, bookkeeperId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">起票時に選ぶ</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <JournalLinesEditor
        lines={form.lines}
        onChange={(lines) => setForm({ ...form, lines })}
        master={master}
        bookkeeperId={form.bookkeeperId}
        memberNoneLabel="起票者と同じ"
        allowBlankAmounts
      />
      <p className="master-note">金額は空欄のまま保存できます。金額を入れた行は、起票時の初期値になります。</p>
    </>
  )
}
