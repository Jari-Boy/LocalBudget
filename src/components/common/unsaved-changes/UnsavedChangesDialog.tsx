import './UnsavedChangesDialog.css'

export interface UnsavedChangesDialogProps {
  /** 保存の実行中。二重に押せないようにする */
  saving?: boolean
  /** 移動をやめて、編集に戻る */
  onCancel: () => void
  /** 編集中の内容を捨てて移動する */
  onDiscard: () => void
  /** 編集中の内容を保存して移動する */
  onSave: () => void
}

/** 保存が完了していない変更があるまま画面を移動しようとしたときの、保存・破棄・キャンセルの確認 */
export function UnsavedChangesDialog({ saving = false, onCancel, onDiscard, onSave }: UnsavedChangesDialogProps) {
  return (
    <div className="unsaved-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label="未保存の変更があります" className="unsaved-dialog">
        <h2 className="unsaved-dialog__title">未保存の変更があります</h2>
        <p className="unsaved-dialog__message">
          保存が完了していない変更があります。保存して移動するか、破棄して移動するかを選んでください。
        </p>
        <div className="unsaved-dialog__actions">
          <button type="button" className="unsaved-dialog__button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="unsaved-dialog__button" disabled={saving} onClick={onDiscard}>
            破棄して移動
          </button>
          <button
            type="button"
            className="unsaved-dialog__button unsaved-dialog__button--primary"
            disabled={saving}
            onClick={onSave}
          >
            保存して移動
          </button>
        </div>
      </div>
    </div>
  )
}
