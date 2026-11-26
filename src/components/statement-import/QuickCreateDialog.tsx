import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { EntitySelect, type EntityGroup } from '../common/entity-select/EntitySelect'

export interface QuickCreateGroupField {
  /** グループの選択欄の名称(「取引先グループ」など) */
  label: string
  /** 選べるグループ。候補の組み立てと階層のインデントは共通の選択欄が行う */
  groups: readonly EntityGroup[]
  /**
   * 渡すと、選択欄の末尾に「+ グループを新規追加」を出す。名前と親グループ(未選択ならnull=最上位)でグループを作り、
   * 作ったグループのidを返す(計画Issue #290)。作ったグループはそのまま選ばれる
   */
  onCreate?: (name: string, parentGroupId: number | null) => Promise<number>
  /** 未選択の項目の表示。既定は「未分類」。親グループの選択欄では「最上位」 */
  emptyLabel?: string
}

export interface QuickCreateDialogProps {
  title: string
  /** 名前の入力欄のラベル */
  nameLabel: string
  /** 名前と、選んだグループ(未選択ならnull)を受け取って作る。groupFieldを渡さなければgroupIdは常にnull */
  onSubmit: (name: string, groupId: number | null) => Promise<void>
  onCancel: () => void
  /** 渡すと、名前の下にグループの選択欄を出す(選ばなければ未分類) */
  groupField?: QuickCreateGroupField
  /** 名前の入力欄の初期値(取込の取引先の追加では、開いた行の摘要。計画Issue #236)。編集できる */
  initialName?: string
  /** グループの選択欄の下に足す欄(取込画面の取引先の追加のキーワードなど)。あるとダイアログを広げる */
  children?: ReactNode
  /** 追加を押したときの追加の検証。falseなら作らずに残る */
  validate?: () => boolean
  /** 名前の入力欄の下に出す注意(同名のバッチがあるなど)。nullなら出さない。追加は止めない(計画Issue #269) */
  nameNotice?: (name: string) => string | null
  /** 追加に失敗したときの文言。既定は取引先の文言 */
  failedMessage?: string
}

/**
 * 取引先・プロジェクトを名前(と、必要ならグループなど)でその場に追加する小さなダイアログ
 * (計画Issue #151・#207)。科目の追加は登録フォーム(AccountCreateForm)を別に使う。
 * 入力欄・見出しは、ほかの項目と同じ見た目(import-control・import-field__label)にそろえる。
 */
export function QuickCreateDialog({
  title,
  nameLabel,
  onSubmit,
  onCancel,
  groupField,
  children,
  validate,
  initialName,
  nameNotice,
  failedMessage,
}: QuickCreateDialogProps) {
  const { t } = useTranslation('statementImport')
  const nameId = useId()
  const [name, setName] = useState(initialName ?? '')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') return
    if (validate && !validate()) return
    setSubmitting(true)
    setFailed(false)
    try {
      await onSubmit(name.trim(), groupId)
    } catch {
      setFailed(true)
      setSubmitting(false)
    }
  }

  // body直下に出す。画面の中の入れ子の重なり順(固定したタブ・バーなど)に左右されず、全体を暗くするため(計画Issue #269の実機確認での指摘)
  return createPortal(
    <>
    <div className="import-dialog__backdrop">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`import-dialog${children ? ' import-dialog--wide' : ''}`}
        onSubmit={(e) => void submit(e)}
      >
        <h2 className="import-dialog__title">{title}</h2>
        <div className="import-field">
          <label className="import-field__label" htmlFor={nameId}>
            {nameLabel}
          </label>
          <input id={nameId} className="import-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {(() => {
            const notice = nameNotice?.(name.trim()) ?? null
            return notice === null ? null : (
              <span role="status" className="import-note">
                {notice}
              </span>
            )
          })()}
        </div>
        {groupField && (
          <div className="import-field">
            <span className="import-field__label">{groupField.label}</span>
            <EntitySelect
              label={groupField.label}
              groups={groupField.groups}
              value={groupId}
              emptyLabel={groupField.emptyLabel ?? t('groupUnclassified')}
              onChange={setGroupId}
              onCreate={groupField.onCreate ? () => setGroupDialogOpen(true) : undefined}
              createLabel={t('createGroup')}
            />
          </div>
        )}
        {children}
        {failed && <p role="alert">{failedMessage ?? t('newCounterpartyError')}</p>}
        <div className="import-dialog__actions">
          <button type="button" className="import-btn" onClick={onCancel}>
            {t('cancelButton')}
          </button>
          <button type="submit" className="import-btn import-btn--primary" disabled={submitting || name.trim() === ''}>
            {t('addCounterpartyButton')}
          </button>
        </div>
      </form>
    </div>
    {groupField?.onCreate && groupDialogOpen && (
      // グループの追加は、この追加ダイアログのフォームの外に重ねて出す(フォームの入れ子にしないため)
      <QuickCreateDialog
        title={t('createGroupTitle', { group: groupField.label })}
        nameLabel={t('createGroupName')}
        groupField={{ label: t('parentGroupLabel'), groups: groupField.groups, emptyLabel: t('parentGroupTop') }}
        onSubmit={async (groupName, parentGroupId) => {
          const createdId = await groupField.onCreate!(groupName, parentGroupId)
          setGroupId(createdId)
          setGroupDialogOpen(false)
        }}
        onCancel={() => setGroupDialogOpen(false)}
      />
    )}
    </>,
    document.body,
  )
}
