import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useUnsavedChangesGuard } from './unsavedChangesGuard'
import { loadUnsavedWarningEnabled } from './unsavedWarningSetting'

export interface UnsavedEditGuardOptions {
  /** 入力が保存済みの値と異なる(未保存の編集がある)か */
  dirty: boolean
  /**
   * 編集内容を保存する。保存できて移動してよいときだけtrueを返す。検証エラーなどで保存できなかった
   * ときはfalse(エラーは画面側が表示する)。他のダイアログで確認を続ける場合もfalseにして移動を止める。
   * 省略すると「保存して移動」を出さない(extraActionだけを保存の操作にする。計画Issue #293)
   */
  save?: () => Promise<boolean>
  /** ダイアログに、既定の文言のあとに出す説明(計画Issue #231 フェーズ3) */
  description?: string
  /**
   * 「保存して移動」とは別の保存操作(例: 確定せずに一時保存して移動)。ダイアログに、押すとrunを実行して、
   * trueなら移動するボタンを足す。falseや例外のときは、saveと同じく移動せずダイアログを閉じる
   */
  extraAction?: { label: string; run: () => Promise<boolean> }
}

/**
 * 編集パネル(マスタの各タブ)の未保存の編集のガード(計画Issue #190)。未保存の間だけ確認を登録し、
 * サイドナビ・領域タブのリンク(GuardedLink)と、画面内の操作(useGuardedAction)が移動の前に通す。
 * 設定が「出さない」のときは、確認もリロード・タブを閉じる操作の警告(beforeunload)も登録しない。
 * 戻り値のダイアログを、編集パネルの中に描画する。保存に失敗したときは移動せずダイアログを閉じる。
 */
export function useUnsavedEditGuard({ dirty, save, description, extraAction }: UnsavedEditGuardOptions): ReactNode {
  const guard = useUnsavedChangesGuard()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [saving, setSaving] = useState(false)
  const active = dirty && loadUnsavedWarningEnabled()

  useEffect(() => {
    if (!active) return
    guard.register((proceed) => {
      setPending(() => proceed)
      return true
    })
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => {
      guard.register(null)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [active, guard])

  if (pending === null) return null

  const saveAndLeave = async (run: () => Promise<boolean>) => {
    setSaving(true)
    let saved = false
    try {
      saved = await run()
    } catch {
      saved = false
    }
    setSaving(false)
    setPending(null)
    if (saved) pending()
  }

  return (
    <UnsavedChangesDialog
      saving={saving}
      onCancel={() => setPending(null)}
      onDiscard={() => {
        setPending(null)
        pending()
      }}
      onSave={save && (() => void saveAndLeave(save))}
      description={description}
      extraAction={extraAction && { label: extraAction.label, onClick: () => void saveAndLeave(extraAction.run) }}
    />
  )
}

/**
 * 画面内の操作(行の選択・新規作成の開始など)を、未保存の編集があれば確認を通してから実行する関数を返す。
 * 確認を登録している編集パネルが無ければ、すぐに実行する。
 */
export function useGuardedAction(): (action: () => void) => void {
  const guard = useUnsavedChangesGuard()
  return useCallback(
    (action) => {
      if (!guard.intercept(action)) action()
    },
    [guard],
  )
}
