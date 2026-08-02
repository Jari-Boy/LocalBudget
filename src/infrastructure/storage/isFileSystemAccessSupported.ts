/**
 * File System Access API(showDirectoryPicker)が現在の実行環境で利用可能かどうかを
 * 静的に判定する(docs/architecture.md 4.2節)。Chromium系のみ対応であり、
 * Firefox/Safariでは`showDirectoryPicker`自体が存在しない。UI側がこの関数を使うことで
 * `'showDirectoryPicker' in window`等の機能検出コードを個別に書かずに選択肢の
 * 出し分けができる(計画Issue #57 目標2)。
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}
