import { useEffect, useRef, type ReactNode } from 'react'
import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  /** ダイアログの名前(見出し) */
  title: string
  message: ReactNode
  /** 実行ボタンの文言(「破棄する」「上書きする」など、押すと何が起きるかが分かる動詞) */
  confirmLabel: string
  cancelLabel?: string
  /** 実行の最中。二重に押せないようにする */
  busy?: boolean
  /** 開いた時点で実行ボタンにフォーカスを置く(Enterで実行できる。計画Issue #237 の「変更を破棄しますか?」) */
  focusConfirm?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * はい/いいえの確認ダイアログ(計画Issue #231 フェーズ3)。取り消せない操作(一時保存の破棄・上書き)の前に使う。
 * Escapeキーでキャンセルになる。見た目は未保存の警告(UnsavedChangesDialog)と同じ。
 */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'キャンセル', busy = false, focusConfirm = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusConfirm) confirmRef.current?.focus()
  }, [focusConfirm])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="confirm-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label={title} className="confirm-dialog">
        <h2 className="confirm-dialog__title">{title}</h2>
        <p className="confirm-dialog__message">{message}</p>
        <div className="confirm-dialog__actions">
          <button type="button" className="confirm-dialog__button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="confirm-dialog__button confirm-dialog__button--primary" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
