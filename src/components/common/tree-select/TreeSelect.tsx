import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  buildTreeSelectRows,
  GROUP_VALUE_PREFIX,
  type TreeSelectCategory,
  type TreeSelectNode,
} from './treeSelectModel'
import './TreeSelect.css'

export interface TreeSelectProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベルに使う) */
  label: string
  categories: readonly TreeSelectCategory[]
  /** 項目の値、または「g:グループID」。未選択は空文字 */
  value: string
  onChange: (value: string) => void
  /** trueのとき、グループごと選択するボタン(「すべて」)を出す */
  allowGroupSelect?: boolean
  /** 渡すと、先頭に選択解除の項目(値は空文字)を出す */
  emptyLabel?: string
  /** 未選択のときにボタンへ出す文言 */
  placeholder?: string
  /** 渡すと、一覧の末尾に「+ 新規追加」を出す。押すと閉じてから呼ぶ(追加の画面は呼び出し側が開く) */
  onCreate?: () => void
  /** 新規追加ボタンの文言(「+ 」は自動で付く)。省略時は「新規追加」 */
  createLabel?: string
}

function findGroupName(nodes: readonly TreeSelectNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    if (node.id === id) return node.name
    const nested = findGroupName(node.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

function findItemName(nodes: readonly TreeSelectNode[], value: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'item') {
      if (node.value === value) return node.name
    } else {
      const nested = findItemName(node.children, value)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * 科目・取引先・プロジェクトで共通の選択ツリー(計画Issue #150)。ボタンの直下に開き、
 * 検索欄・区分の見出し・入れ子のグループ・折りたたみを持つ。選択中の項目を含むグループだけ
 * 最初から開く。無効な項目は選択中のものを除いて出さない。外側のクリックとEscで閉じる。
 * 表示行の組み立ては純粋関数(buildTreeSelectRows)に切り出している。
 */
export function TreeSelect({
  label,
  categories,
  value,
  onChange,
  allowGroupSelect = false,
  emptyLabel,
  placeholder = '指定なし',
  onCreate,
  createLabel = '新規追加',
}: TreeSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const popupId = useId()

  const rows = useMemo(
    () => buildTreeSelectRows({ categories, selectedValue: value, query, openOverrides }),
    [categories, value, query, openOverrides],
  )

  const selectedText = useMemo(() => {
    if (value === '') return placeholder
    if (value.startsWith(GROUP_VALUE_PREFIX)) {
      const id = value.slice(GROUP_VALUE_PREFIX.length)
      for (const category of categories) {
        const name = findGroupName(category.nodes, id)
        if (name !== undefined) return `${name}(配下すべて)`
      }
      return value
    }
    for (const category of categories) {
      const name = findItemName(category.nodes, value)
      if (name !== undefined) return name
    }
    return value
  }, [categories, value, placeholder])

  useEffect(() => {
    if (!isOpen) return
    searchRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  const open = () => {
    setQuery('')
    setOpenOverrides({})
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (next: string) => {
    onChange(next)
    close()
  }

  const toggleGroup = (id: string, currentlyOpen: boolean) =>
    setOpenOverrides((prev) => ({ ...prev, [id]: !currentlyOpen }))

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // 外側のポップアップ(絞り込み等)の中で使われても、閉じるのはこのツリーだけにする
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const focusables: HTMLElement[] = [
      ...(searchRef.current ? [searchRef.current] : []),
      ...Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ]
    const index = focusables.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    focusables[Math.min(Math.max(next, 0), focusables.length - 1)]?.focus()
  }

  return (
    <div className="tree-select" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`tree-select__trigger${value === '' ? ' tree-select__trigger--empty' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
        aria-label={`${label}: ${selectedText}`}
        onClick={() => (isOpen ? close() : open())}
      >
        <span className="tree-select__trigger-text">{selectedText}</span>
        <span aria-hidden="true" className="tree-select__caret">
          ▾
        </span>
      </button>
      {isOpen && (
        <div
          id={popupId}
          role="dialog"
          aria-label={label}
          className="tree-select__popup"
          onKeyDown={handleKeyDown}
        >
          <input
            ref={searchRef}
            type="search"
            className="tree-select__search"
            aria-label={`${label}を検索`}
            placeholder={`${label}を検索`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="tree-select__list" ref={listRef}>
            {emptyLabel !== undefined && query.trim() === '' && (
              <button
                type="button"
                className={`tree-select__item${value === '' ? ' tree-select__item--selected' : ''}`}
                style={{ paddingLeft: 8 }}
                aria-current={value === '' ? 'true' : undefined}
                onClick={() => choose('')}
              >
                {emptyLabel}
              </button>
            )}
            {rows.map((row) => {
              if (row.type === 'category') {
                return (
                  <div key={`c:${row.name}`} className="tree-select__category">
                    {row.name}
                  </div>
                )
              }
              if (row.type === 'group') {
                return (
                  <div key={`g:${row.id}`} className="tree-select__group-row">
                    <button
                      type="button"
                      className="tree-select__group"
                      style={{ paddingLeft: row.indent }}
                      aria-label={row.name}
                      aria-expanded={row.isOpen}
                      onClick={() => toggleGroup(row.id, row.isOpen)}
                    >
                      <span aria-hidden="true">{row.isOpen ? '▾' : '▸'}</span> {row.name}
                      <span className="tree-select__count"> {row.count}件</span>
                    </button>
                    {allowGroupSelect && (
                      <button
                        type="button"
                        className="tree-select__select-all"
                        aria-label={`${row.name}をすべて選ぶ`}
                        onClick={() => choose(row.value)}
                      >
                        すべて
                      </button>
                    )}
                  </div>
                )
              }
              return (
                <button
                  key={`i:${row.value}`}
                  type="button"
                  className={`tree-select__item${row.isSelected ? ' tree-select__item--selected' : ''}`}
                  style={{ paddingLeft: row.indent }}
                  aria-current={row.isSelected ? 'true' : undefined}
                  onClick={() => choose(row.value)}
                >
                  {row.name}
                </button>
              )
            })}
            {rows.length === 0 && <p className="tree-select__empty">該当する項目がありません</p>}
            {onCreate !== undefined && (
              <button
                type="button"
                className="tree-select__item tree-select__create"
                style={{ paddingLeft: 8 }}
                onClick={() => {
                  close()
                  onCreate()
                }}
              >
                {`+ ${createLabel}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
