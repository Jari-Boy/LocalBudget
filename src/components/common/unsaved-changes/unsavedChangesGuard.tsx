import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router'

/**
 * 画面を離れる前の確認。引き受けたときはtrueを返し、離れてよくなったら渡された続行関数を呼ぶ。
 * 引き受けない(未保存の変更が無い)ときはfalseを返し、呼び出し側がそのまま移動する。
 */
export type LeaveInterceptor = (proceed: () => void) => boolean

export interface UnsavedChangesGuard {
  /** 画面が登録した確認を呼ぶ。引き受けられたらtrue */
  intercept: (proceed: () => void) => boolean
  /** 確認を登録する(nullで解除)。同時に登録できるのは1つ */
  register: (interceptor: LeaveInterceptor | null) => void
}

/** ガードの外(プロバイダが無い)では何も止めない */
const passThrough: UnsavedChangesGuard = { intercept: () => false, register: () => {} }

const GuardContext = createContext<UnsavedChangesGuard>(passThrough)

/**
 * 未保存の変更のガード(HashRouterはuseBlockerを使えないため、移動のリンクがこのガードを通す形にする)。
 * 画面(仕訳画面など)が未保存の変更を持つ間だけ確認を登録し、サイドナビなどのリンクが移動の前に呼ぶ。
 */
export function UnsavedChangesGuardProvider({ children }: { children: ReactNode }) {
  const ref = useRef<LeaveInterceptor | null>(null)
  const value = useMemo<UnsavedChangesGuard>(
    () => ({
      intercept: (proceed) => ref.current?.(proceed) ?? false,
      register: (interceptor) => {
        ref.current = interceptor
      },
    }),
    [],
  )
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>
}

export function useUnsavedChangesGuard(): UnsavedChangesGuard {
  return useContext(GuardContext)
}

/** 移動の前にガードの確認を通すLink。新しいタブで開く操作(修飾キー・中クリック)は止めない */
export function GuardedLink({ to, onClick, ...rest }: LinkProps) {
  const guard = useUnsavedChangesGuard()
  const navigate = useNavigate()
  return (
    <Link
      to={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (guard.intercept(() => navigate(to))) event.preventDefault()
      }}
    />
  )
}
