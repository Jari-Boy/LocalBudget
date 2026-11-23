import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { ConfirmDialog } from '../confirm-dialog/ConfirmDialog'

export interface EscapeDiscardOptions {
  /** 入力が保存済みの値と異なる(未保存の編集がある)か。falseの間はEscを何もしない扱いにする */
  dirty: boolean
  /** 「破棄する」が押されたときに、入力を保存済みの値に戻す */
  onDiscard: () => void
}

export interface EscapeDiscard {
  /** 詳細パネルのルート要素のonKeyDownに渡す。パネルの中にフォーカスがあるときのEscだけを受ける */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  /** 確認ダイアログ。パネルの中に描画する(閉じている間はnull) */
  dialog: ReactNode
}

/**
 * 詳細パネルで Esc を押したとき、変更があれば「変更を破棄しますか?」の確認を出す(計画Issue #237)。
 * 確認ではフォーカスが「破棄する」にあり、Enterで破棄、Esc・「編集を続ける」で閉じるだけ。
 * 次のEscは対象にしない: 変更が無いとき、日本語入力の変換中(変換の取り消しに使われる)、他の部品が処理済み
 * (preventDefault。選択欄のポップアップを閉じるEsc等)、ダイアログの中(確認自身・未保存の警告)。
 * パネルの「キャンセル」ボタンのクリックは確認なしで戻すので、このフックは通さない。
 */
export function useEscapeDiscard({ dirty, onDiscard }: EscapeDiscardOptions): EscapeDiscard {
  const [confirming, setConfirming] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if ((event.target as Element).closest('[role="dialog"], [aria-modal="true"]') !== null) return
    if (!dirty || confirming) return
    event.preventDefault()
    setConfirming(true)
  }

  const dialog = confirming ? (
    <ConfirmDialog
      title="変更を破棄しますか?"
      message="保存していない変更は、元に戻せません。"
      confirmLabel="破棄する"
      cancelLabel="編集を続ける"
      focusConfirm
      onConfirm={() => {
        setConfirming(false)
        onDiscard()
      }}
      onCancel={() => setConfirming(false)}
    />
  ) : null

  return { onKeyDown, dialog }
}
