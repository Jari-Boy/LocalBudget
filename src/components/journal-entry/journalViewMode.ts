/**
 * 仕訳一覧の表示方式(計画Issue #182)。「仕訳単位」は従来の1仕訳1行の要約と詳細パネル、
 * 「明細行単位」は借方・貸方の明細行を並べた表。選んだ方式はlocalStorageに保存し、再訪時に復元する。
 * 初期値は仕訳単位。localStorageが使えない環境や不正な値でも仕訳単位に倒れ、画面は壊れない。
 */
export type JournalViewMode = 'entry' | 'line'

const STORAGE_KEY = 'localbudget:journal-view-mode'

export function loadJournalViewMode(): JournalViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'line' ? 'line' : 'entry'
  } catch {
    return 'entry'
  }
}

export function saveJournalViewMode(mode: JournalViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 保存できなくても表示方式の切替自体は動く(次回は仕訳単位に戻る)
  }
}
