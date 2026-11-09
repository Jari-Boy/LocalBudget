import { useState } from 'react'
import '../common/unsaved-changes/UnsavedChangesDialog.css'

export interface DefaultMemberChangeDialogProps {
  accountName: string
  /** 変更前の既定の世帯メンバーの名前。なければ「なし」 */
  fromName: string
  toName: string
  /** 新しい既定メンバーと異なる世帯メンバーを持つ、この科目の過去の明細行の件数 */
  lineCount: number
  /** 処理中。二重に押せないようにする */
  busy: boolean
  onCancel: () => void
  /** updateExistingLines: 過去の明細行も新しい既定メンバーに更新するか */
  onConfirm: (updateExistingLines: boolean) => void
}

/**
 * 科目の既定の世帯メンバーを変えるときの確認(計画Issue #169)。既定メンバーの変更には、設定ミスの修正
 * (過去の明細行も更新するのが正しい)と、名義が実際に変わった場合や既定の新規設定(過去の明細行は
 * 履歴としてそのまま残すのが正しい)の2種類があるため、件数を示してどちらにするかを選ばせる。
 * 見た目は未保存の変更の確認(UnsavedChangesDialog)と同じダイアログの部品を使う。
 */
export function DefaultMemberChangeDialog({
  accountName,
  fromName,
  toName,
  lineCount,
  busy,
  onCancel,
  onConfirm,
}: DefaultMemberChangeDialogProps) {
  const [updateExistingLines, setUpdateExistingLines] = useState(true)

  return (
    <div className="unsaved-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label="既定の世帯メンバーの変更" className="unsaved-dialog">
        <h2 className="unsaved-dialog__title">既定の世帯メンバーを変更します</h2>
        <p className="unsaved-dialog__message">
          科目「{accountName}」の既定メンバーを <b>{fromName} → {toName}</b> に変更します。
          <br />
          この科目を使っている過去の明細行が <b>{lineCount} 件</b> あります。
        </p>
        <label className="unsaved-dialog__choice">
          <input
            type="radio"
            name="default-member-change"
            checked={updateExistingLines}
            onChange={() => setUpdateExistingLines(true)}
          />
          <span>
            <b>過去の明細行も更新する</b>
            <br />
            <span className="unsaved-dialog__hint">
              設定ミスの修正向け。行ごとに別メンバーを指定していた分も上書きされ、精算済みの精算バッチが未精算に戻ることがあります。
            </span>
          </span>
        </label>
        <label className="unsaved-dialog__choice">
          <input
            type="radio"
            name="default-member-change"
            checked={!updateExistingLines}
            onChange={() => setUpdateExistingLines(false)}
          />
          <span>
            <b>そのまま残す</b>
            <br />
            <span className="unsaved-dialog__hint">
              名義が変わった場合向け。過去の行は旧メンバーのまま履歴として残り、新しい仕訳から{toName}になります。
            </span>
          </span>
        </label>
        <div className="unsaved-dialog__actions">
          <button type="button" className="unsaved-dialog__button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="unsaved-dialog__button unsaved-dialog__button--primary"
            disabled={busy}
            onClick={() => onConfirm(updateExistingLines)}
          >
            変更する
          </button>
        </div>
      </div>
    </div>
  )
}
