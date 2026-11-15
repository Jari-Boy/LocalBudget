import { useEffect, useRef, useState } from 'react'
import type { JournalTemplate, UpdateJournalTemplateInput } from '../../domain/journal-template/JournalTemplate'
import { JournalEntryEditor, type JournalEditorMaster, type JournalEditorValue } from '../journal-entry/JournalEntryEditor'
import type { LeafFormState } from '../master/GroupedMasterTab'
import {
  buildTemplateUpdateInput,
  isTemplateFormDirty,
  templateFormFromTemplate,
  validateTemplateForm,
  type JournalTemplateForm,
} from './journalTemplateForm'
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
 * テンプレートの右パネルに出す、摘要・起票者・明細行のフォーム(計画Issue #201)。仕訳の入力欄
 * (JournalEntryEditor)をそのまま使い、見た目と動き(起票者を変えると手で変えていない行の世帯メンバーが追従する、
 * 科目に応じた取引先・精算バッチ欄、借方・貸方の2列、貸借の表示)を仕訳の入力と同じにする。テンプレートが
 * 持たない取引日とコメントは隠し、金額の空欄を許し(空欄の行は起票時に入力する)、起票者は「起票時に選ぶ」(決めない)を選べる。
 * フォームの内容・保存できるか・保存の処理を、変わるたびに親(GroupedMasterTab)へ渡し、親の「保存」と
 * 未保存の警告が名称と一緒に扱う。
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

  // 仕訳の入力欄の値へ変換する。テンプレートが持たない取引日・コメントは使わない(空のまま)
  const value: JournalEditorValue = {
    entryDate: '',
    memo: form.memo,
    comment: '',
    householdMemberId: form.bookkeeperId,
    lines: form.lines,
  }

  return (
    <>
      <JournalEntryEditor
        value={value}
        onChange={(next) => setForm({ memo: next.memo, bookkeeperId: next.householdMemberId, lines: next.lines })}
        master={master}
        hideEntryDate
        hideComment
        allowBlankAmounts
        bookkeeperNoneLabel="起票時に選ぶ"
        memberNoneLabel="起票者と同じ"
      />
      <p className="master-note">
        摘要・起票者・金額は、起票時の初期値になります。金額は空欄のまま保存でき、空欄の行は起票時に入力します。
      </p>
    </>
  )
}
