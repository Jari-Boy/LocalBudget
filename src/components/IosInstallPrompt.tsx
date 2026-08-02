import { useEffect, useState } from 'react'
import { isIos } from '../infrastructure/pwa/isIos'
import { isStandaloneDisplayMode } from '../infrastructure/pwa/isStandaloneDisplayMode'
import {
  isIosInstallPromptDismissed,
  dismissIosInstallPrompt,
} from '../infrastructure/pwa/iosInstallPromptDismissal'
import './IosInstallPrompt.css'

/**
 * iOS(beforeinstallpromptに非対応)向けに「ホーム画面に追加」を促すポップアップ。
 * docs/architecture.md 7章・計画Issue #28で確定した方針により、「今後表示しない」
 * チェックボックスを明示的にオンにして閉じない限り、再訪問のたびに再表示する。
 */
export function IosInstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    if (
      isIos(navigator.userAgent) &&
      !isStandaloneDisplayMode() &&
      !isIosInstallPromptDismissed()
    ) {
      setVisible(true)
    }
  }, [])

  if (!visible) {
    return null
  }

  const handleClose = () => {
    if (dontShowAgain) {
      dismissIosInstallPrompt()
    }
    setVisible(false)
  }

  return (
    <div className="ios-install-prompt-overlay">
      <div role="dialog" aria-modal="true" aria-label="ホーム画面に追加" className="ios-install-prompt">
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
        <button type="button" onClick={handleClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}
