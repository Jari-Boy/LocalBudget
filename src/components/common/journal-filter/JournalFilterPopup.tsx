import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { countActiveConditions } from './journalFilterModel'
import { JournalFilterPanel, type JournalFilterPanelProps } from './JournalFilterPanel'
import './JournalFilterPopup.css'

/**
 * 仕訳の絞り込みパネルをボタンの下にポップアップで開く版(計画Issue #150)。
 * ボタンには有効な条件の数を出す。外側のクリックとEscで閉じる。選択ツリーのEscは
 * ツリーだけを閉じる(TreeSelectが伝播を止めるため、ポップアップごと閉じない)。
 */
export function JournalFilterPopup(props: JournalFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupId = useId()
  const count = countActiveConditions(props.filter)

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  const close = () => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="journal-filter-popup" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="journal-filter-popup__trigger"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
      >
        {count > 0 ? `絞り込み(${count})` : '絞り込み'}
      </button>
      {isOpen && (
        <div id={popupId} className="journal-filter-popup__body" onKeyDown={handleKeyDown}>
          <JournalFilterPanel {...props} />
        </div>
      )}
    </div>
  )
}
