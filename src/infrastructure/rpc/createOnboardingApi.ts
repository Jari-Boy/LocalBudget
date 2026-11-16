import type { Database } from 'sql.js'
import {
  completeOnboarding,
  dismissOnboardingChecklist,
  getOnboardingChecklist,
  isOnboardingCompleted,
  markChecklistBackupDone,
  skipOnboarding,
  type CompleteOnboardingInput,
  type OnboardingChecklist,
} from '../db/onboarding'

export interface OnboardingStatus {
  /** 初回セットアップが済んでいる(または既存の利用者として判定された)。DBの状態で、保存先を切り替えても食い違わない */
  completed: boolean
}

/**
 * 初回セットアップ(計画Issue #177)のRPC API。UIはcompletedがfalseのときだけウェルカム・初期設定の画面を出す。
 * 操作履歴(ロールバック、計画Issue #202)には記録しない。セットアップの途中までを「取り消す」と、
 * 完了の印だけが残る中途半端な状態になりうるため、レジストリの`recorded`では包まない。
 */
export interface OnboardingRpcApi {
  getStatus(): OnboardingStatus
  complete(input: CompleteOnboardingInput): void
  skip(): void
  /** 「はじめのチェックリスト」の表示と各項目の達成(DBの状態から求める) */
  getChecklist(): OnboardingChecklist
  /** チェックリストを閉じる */
  dismissChecklist(): void
  /** チェックリストの「バックアップを1度取る」を、利用者が済みにする */
  markBackupDone(): void
}

export function createOnboardingApi(db: Database): OnboardingRpcApi {
  return {
    getStatus: () => ({ completed: isOnboardingCompleted(db) }),
    complete: (input) => completeOnboarding(db, input),
    skip: () => skipOnboarding(db),
    getChecklist: () => getOnboardingChecklist(db),
    dismissChecklist: () => dismissOnboardingChecklist(db),
    markBackupDone: () => markChecklistBackupDone(db),
  }
}
