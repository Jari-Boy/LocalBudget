import type { Database } from 'sql.js'
import {
  completeOnboarding,
  isOnboardingCompleted,
  skipOnboarding,
  type CompleteOnboardingInput,
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
}

export function createOnboardingApi(db: Database): OnboardingRpcApi {
  return {
    getStatus: () => ({ completed: isOnboardingCompleted(db) }),
    complete: (input) => completeOnboarding(db, input),
    skip: () => skipOnboarding(db),
  }
}
