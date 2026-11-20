/**
 * キー操作の対象要素の判定(計画Issue #235)。選択の全解除(Esc)や範囲選択(Shift+↑↓)のような画面全体の
 * キー操作が、テキスト入力・select・ダイアログの中の操作と競合しないよう、押された時点の対象要素から
 * 「その操作に任せるべきか」を判定する。DOM の要素だけを見る純粋な関数で、React・DB には依存しない。
 */

/** 文字を入力しない input の種類(チェック・ボタンなど)。ここに無い種類(text・number・search など)は文字入力として扱う */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'range',
  'color',
])

function asElement(target: EventTarget | null): Element | null {
  return typeof Element !== 'undefined' && target instanceof Element ? target : null
}

/**
 * 文字入力の対象か: テキスト系の input・textarea・select・contenteditable(の中)。
 * チェックボックス・ラジオ・ボタンは、押したあとにフォーカスが残るだけで文字は入力しないので false
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = asElement(target)
  if (element === null) return false
  if (element.closest('[contenteditable=""], [contenteditable="true"]') !== null) return true
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((element as HTMLInputElement).type)
  return false
}

/**
 * Esc を、その要素自身が扱うか: 文字入力の対象(入力の取り消しなど)と、ダイアログの中(Esc で閉じる)。
 * 画面全体の「Esc で選択を全解除」は、true のときは何もしない
 */
export function ownsEscapeKey(target: EventTarget | null): boolean {
  if (isTextEntryTarget(target)) return true
  return asElement(target)?.closest('[role="dialog"], [aria-modal="true"]') != null
}
