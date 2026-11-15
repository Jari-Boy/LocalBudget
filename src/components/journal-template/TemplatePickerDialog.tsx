import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { describeTemplateContent, summarizeTemplateAmount } from '../../domain/journal-template/describeJournalTemplate'
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import { listTemplatePickerItems } from '../../domain/journal-template/listTemplatePickerItems'
import type { JournalTemplateGroup } from '../../domain/journal-template-group/JournalTemplateGroup'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import '../master/master.css'
import './TemplatePickerDialog.css'

export interface TemplatePickerDialogProps {
  groups: readonly JournalTemplateGroup[]
  templates: readonly JournalTemplate[]
  accountNameById: ReadonlyMap<number, string>
  counterpartyNameById: ReadonlyMap<number, string>
  /** テンプレートを決定した */
  onSelect: (template: JournalTemplate) => void
  onCancel: () => void
}

/**
 * 「テンプレートから起票」のダイアログ(計画Issue #201)。マスタの並び順・グループの見出しのまま
 * 有効なテンプレートを一覧し、検索語(名称・摘要・科目名・取引先名)があるときはグループ見出しの無い絞り込み表示にする。
 * 最初のテンプレートが選ばれた状態で開き、上下キーで選択を移し、Enter・「このテンプレートで起票」・
 * 行のダブルクリックで決定する。Escapeかキャンセルで閉じる。開いたとき検索欄にフォーカスがあり、
 * Tab/Shift+Tabはダイアログの外に出ない(フォーカストラップ)。選択はリストボックスのaria-activedescendantで伝える。
 */
export function TemplatePickerDialog({
  groups,
  templates,
  accountNameById,
  counterpartyNameById,
  onSelect,
  onCancel,
}: TemplatePickerDialogProps) {
  const [query, setQuery] = useState('')
  const [chosenId, setChosenId] = useState<number | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const items = listTemplatePickerItems({ groups, templates, accountNameById, counterpartyNameById, query })
  const visible = items.flatMap((item) => (item.kind === 'template' ? [item.template] : []))
  // 選ばれているものが絞り込みなどで見えなくなったら、先頭に戻す
  const active = visible.find((t) => t.id === chosenId) ?? visible[0] ?? null
  const hasAnyTemplate = templates.some((t) => t.isActive)

  useEffect(() => {
    if (active === null) return
    document.getElementById(optionId(active.id))?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const move = (delta: -1 | 1) => {
    if (active === null) return
    const index = visible.findIndex((t) => t.id === active.id)
    const next = visible[Math.min(Math.max(index + delta, 0), visible.length - 1)]
    setChosenId(next.id)
  }

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const onButton = (event.target as HTMLElement).tagName === 'BUTTON'
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Tab') {
      trapTab(event)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && !onButton && active !== null) {
      event.preventDefault()
      onSelect(active)
    }
  }

  return (
    <div className="template-picker__backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="テンプレートから起票"
        className="template-picker"
        onKeyDown={onKeyDown}
      >
        <h2 className="template-picker__title">テンプレートから起票</h2>
        <input
          ref={searchRef}
          className="template-picker__search"
          type="search"
          aria-label="テンプレートを検索"
          placeholder="名称・科目・取引先で検索"
          aria-controls="template-picker-list"
          aria-activedescendant={active === null ? undefined : optionId(active.id)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          id="template-picker-list"
          role="listbox"
          aria-label="テンプレート。上下キーで選択を移動、Enterで決定"
          className="template-picker__list"
        >
          {items.length === 0 && (
            <p className="template-picker__empty">
              {hasAnyTemplate
                ? '該当するテンプレートがありません'
                : 'テンプレートがありません。仕訳画面の「テンプレート」タブで追加できます'}
            </p>
          )}
          {items.map((item) => {
            if (item.kind === 'group') {
              return (
                <div
                  key={`g${item.group.id}`}
                  role="presentation"
                  className="template-picker__group"
                  style={{ paddingLeft: 12 + item.depth * 18 }}
                >
                  <span aria-hidden="true">▾</span>
                  <span>{item.group.name}</span>
                </div>
              )
            }
            const { template } = item
            return (
              <div
                key={`t${template.id}`}
                id={optionId(template.id)}
                role="option"
                aria-selected={active?.id === template.id}
                className="template-picker__item"
                style={{ paddingLeft: 12 + item.depth * 18 }}
                onClick={() => setChosenId(template.id)}
                onDoubleClick={() => onSelect(template)}
              >
                <span className="template-picker__name">{template.name}</span>
                <span className="template-picker__sub">{describeTemplateContent(template, accountNameById)}</span>
                <span className="template-picker__amount">{amountText(template)}</span>
              </div>
            )
          })}
        </div>
        <p className="template-picker__note">
          マスタの並び順とグループのまま表示します。無効なテンプレートは出ません。入力中の内容があるときは、選ぶ前に破棄の確認を出します。
        </p>
        <div className="template-picker__actions">
          <button type="button" className="master-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="master-btn master-btn--primary"
            disabled={active === null}
            onClick={() => active !== null && onSelect(active)}
          >
            このテンプレートで起票
          </button>
        </div>
      </div>
    </div>
  )
}

function optionId(templateId: number): string {
  return `template-picker-option-${templateId}`
}

function amountText(template: JournalTemplate): string {
  const summary = summarizeTemplateAmount(template)
  if (summary.kind === 'fixed') return formatCurrency(summary.total, 'JPY')
  return summary.kind === 'input' ? '金額は入力' : '一部入力'
}
