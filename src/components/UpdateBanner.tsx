import { useRegisterSW } from 'virtual:pwa-register/react'
import './UpdateBanner.css'

/**
 * 新しいService Workerを検出した際に表示する、画面下部固定の非モーダルバナー。
 * docs/architecture.md 7章の方針(自動更新はDB書き込み中の強制リロードで
 * トランザクションを破壊するリスクがあるため採用しない)により、ユーザーが
 * 「更新する」を選択するまで自動更新せず、現在の画面での作業を継続できる。
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) {
    return null
  }

  return (
    <div className="update-banner">
      <p role="alert">新しいバージョンが利用可能です</p>
      <button type="button" onClick={() => updateServiceWorker()}>
        更新する
      </button>
    </div>
  )
}
