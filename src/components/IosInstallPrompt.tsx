import { useEffect, useRef, useState } from 'react'
import { isIos } from '../infrastructure/pwa/isIos'
import { isStandaloneDisplayMode } from '../infrastructure/pwa/isStandaloneDisplayMode'
import {
  isIosInstallPromptDismissed,
  dismissIosInstallPrompt,
} from '../infrastructure/pwa/iosInstallPromptDismissal'
import './IosInstallPrompt.css'

const FOCUSABLE_SELECTOR =
  'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * iOS(beforeinstallpromptに非対応)向けに「ホーム画面に追加」を促すポップアップ。
 * docs/architecture.md 7章・計画Issue #28で確定した方針により、「今後表示しない」
 * チェックボックスを明示的にオンにして閉じない限り、再訪問のたびに再表示する。
 * aria-modal="true"のダイアログのため、表示中はフォーカスをダイアログ内に閉じ込め
 * (Tab/Shift+Tabでの循環)、Escapeキーでも閉じられるようにする。
 */
export function IosInstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (
      isIos(navigator.userAgent) &&
      !isStandaloneDisplayMode() &&
      !isIosInstallPromptDismissed()
    ) {
      setVisible(true)
    }
  }, [])

  const handleClose = () => {
    if (dontShowAgain) {
      dismissIosInstallPrompt()
    }
    setVisible(false)
  }

  // Escapeキー押下時に常に最新のdontShowAgain状態を反映したhandleCloseを呼べるよう
  // refで保持する。これによりuseEffectの依存配列を[visible]のみにでき、
  // チェックボックス操作(dontShowAgainの変更)のたびにeffectが再実行されて
  // フォーカスが強制的に閉じるボタンへ戻ってしまう副作用を避ける。
  const handleCloseRef = useRef(handleClose)
  handleCloseRef.current = handleClose

  useEffect(() => {
    if (!visible) {
      return
    }
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseRef.current()
        return
      }
      if (event.key !== 'Tab') {
        return
      }

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusable || focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible])

  if (!visible) {
    return null
  }

  return (
    <div className="ios-install-prompt-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="ホーム画面に追加"
        className="ios-install-prompt"
      >
        <p>
          このアプリをホーム画面に追加すると、次回からアイコンからすぐに起動できます。
          共有ボタンから「ホーム画面に追加」を選択してください。
        </p>
        <label>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
          />
          今後表示しない
        </label>
        <button ref={closeButtonRef} type="button" onClick={handleClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}
