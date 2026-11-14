import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useUnsavedChangesGuard } from './unsavedChangesGuard'
import { loadUnsavedWarningEnabled } from './unsavedWarningSetting'

export interface UnsavedEditGuardOptions {
  /** 入力が保存済みの値と異なる(未保存の編集がある)か */
  dirty: boolean
  /**
   * 編集内容を保存する。保存できて移動してよいときだけtrueを返す。検証エラーなどで保存できなかった
   * ときはfalse(エラーは画面側が表示する)。他のダイアログで確認を続ける場合もfalseにして移動を止める
   */
  save: () => Promise<boolean>
}

/**
 * 編集パネル(マスタの各タブ)の未保存の編集のガード(計画Issue #190)。未保存の間だけ確認を登録し、
 * サイドナビ・領域タブのリンク(GuardedLink)と、画面内の操作(useGuardedAction)が移動の前に通す。
 * 設定が「出さない」のときは、確認もリロード・タブを閉じる操作の警告(beforeunload)も登録しない。
 * 戻り値のダイアログを、編集パネルの中に描画する。保存に失敗したときは移動せずダイアログを閉じる。
 */
export function useUnsavedEditGuard({ dirty, save }: UnsavedEditGuardOptions): ReactNode {
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

  const saveAndLeave = async () => {
    setSaving(true)
    let saved = false
    try {
      saved = await save()
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
      onSave={() => void saveAndLeave()}
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
