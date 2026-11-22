import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useFavorites, type FavoriteKind } from '../favorites/FavoritesContext'
import { matchesSearch } from './normalizeForSearch'
import {
  buildTreeSelectRows,
  GROUP_VALUE_PREFIX,
  type TreeSelectCategory,
  type TreeSelectItemNode,
  type TreeSelectNode,
} from './treeSelectModel'
import './TreeSelect.css'

interface TreeSelectBaseProps {
  /** 項目の名称(ボタンの前置き・検索欄・ポップアップのラベルに使う) */
  label: string
  categories: readonly TreeSelectCategory[]
  /** trueのとき、グループごと選択するボタン(「すべて」)を出す */
  allowGroupSelect?: boolean
  /** 渡すと、先頭に選択解除の項目(値は空文字)を出す */
  emptyLabel?: string
  /**
   * 実体ではない特別な選択肢(「変更しない」「未設定にする」など、計画Issue #234)。一覧の先頭に固定し、検索中も消えない。
   * 値は実体の値と重ならない文字列にする。単一選択のときだけ使う
   */
  leadingOptions?: readonly { value: string; label: string }[]
  /**
   * 一覧の先頭に固定して出す候補の値(渡した順。計画Issue #236)。明細取込で、摘要に複数のキーワードが一致した行の
   * 取引先欄に、一致した取引先を先に出し、その下に標準のマスタ表示を続けるために使う。単一選択のときだけ使う。
   * 検索中は、検索の語に合う候補だけを残す(合うものが無ければ見出しも出さない)
   */
  pinnedValues?: readonly string[]
  /** 先頭に固定する候補の見出し */
  pinnedLabel?: string
  /** 未選択のときにボタンへ出す文言 */
  placeholder?: string
  /** 渡すと、一覧の末尾に「+ 新規追加」を出す。押すと閉じてから呼ぶ(追加の画面は呼び出し側が開く) */
  onCreate?: () => void
  /** 新規追加ボタンの文言(「+ 」は自動で付く)。省略時は「新規追加」 */
  createLabel?: string
  /** trueのとき、現在の値は表示したまま押せなくする(読み取り専用の表示、計画Issue #164) */
  disabled?: boolean
  /**
   * お気に入り(計画Issue #231 フェーズ4)にできる種類。渡すと、項目の値を、その種類のidとして、
   * 先頭の「★ お気に入り」のセクションと、各項目の★のボタン(付け外し)を出す。お気に入りの状態は、
   * FavoritesProviderが画面全体で持つ(プロバイダーが無いときは、渡しても何も出さない)
   */
  favoriteKind?: FavoriteKind
}

/** 単一選択(従来の動き)。項目を選ぶと閉じる */
interface TreeSelectSingleProps {
  multiple?: false
  /** 項目の値、または「g:グループID」。未選択は空文字 */
  value: string
  onChange: (value: string) => void
}

/**
 * 複数選択(計画Issue #203)。項目・グループを複数選べ、選んでも閉じない(閉じるのはボタンの再押下・Esc・外側のクリック)。
 * 選択中の項目にはチェックを出す。グループの「すべて」はオン/オフで切り替わり、オンの間は配下の項目を
 * グループ経由で対象として示す。emptyLabelの項目は選択をすべて消す。
 */
interface TreeSelectMultiProps {
  multiple: true
  /** 選択中の値(項目の値と「g:グループID」の混在)。未選択は空配列 */
  values: readonly string[]
  onValuesChange: (values: string[]) => void
}

export type TreeSelectProps = TreeSelectBaseProps & (TreeSelectSingleProps | TreeSelectMultiProps)

function findGroupName(nodes: readonly TreeSelectNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    if (node.id === id) return node.name
    const nested = findGroupName(node.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

function collectItems(nodes: readonly TreeSelectNode[]): TreeSelectItemNode[] {
  return nodes.flatMap((node) => (node.kind === 'item' ? [node] : collectItems(node.children)))
}

/**
 * 項目の表示名。パス表示名(pathName)を持つ階層つきの項目は、同名の項目がほかにもあるときだけ「親 > 子」で返す
 * (閉じた状態でも見分けられるように。計画Issue #233)。見つからなければundefined
 */
function findItemName(categories: readonly TreeSelectCategory[], value: string): string | undefined {
  const items = categories.flatMap((category) => collectItems(category.nodes))
  const found = items.find((node) => node.value === value)
  if (found === undefined) return undefined
  const isAmbiguous = found.pathName !== undefined && items.some((node) => node !== found && node.name === found.name)
  return isAmbiguous ? found.pathName : found.name
}

/** 値(項目の値または「g:グループID」)の表示名。見つからなければ値そのもの */
function nameOfValue(categories: readonly TreeSelectCategory[], value: string): string {
  if (value.startsWith(GROUP_VALUE_PREFIX)) {
    const id = value.slice(GROUP_VALUE_PREFIX.length)
    for (const category of categories) {
      const name = findGroupName(category.nodes, id)
      if (name !== undefined) return `${name}(配下すべて)`
    }
    return value
  }
  return findItemName(categories, value) ?? value
}

/**
 * 科目・取引先・プロジェクトで共通の選択ツリー(計画Issue #150)。ボタンの直下に開き、
 * 検索欄・区分の見出し・入れ子のグループ・折りたたみを持つ。選択中の項目を含むグループだけ
 * 最初から開く。無効な項目は選択中のものを除いて出さない。外側のクリックとEscで閉じる。
 * 表示行の組み立ては純粋関数(buildTreeSelectRows)に切り出している。
 */
export function TreeSelect(props: TreeSelectProps) {
  const {
    label,
    categories,
    allowGroupSelect = false,
    emptyLabel,
    leadingOptions,
    pinnedValues,
    pinnedLabel,
    placeholder = '指定なし',
    onCreate,
    createLabel = '新規追加',
    disabled = false,
    favoriteKind,
  } = props
  const isMulti = props.multiple === true
  const favorites = useFavorites()
  const toggleFavorite = favoriteKind !== undefined ? favorites.toggle : undefined
  const favoriteValues = useMemo(
    () => (favoriteKind !== undefined && toggleFavorite !== undefined ? new Set([...favorites.ids[favoriteKind]].map(String)) : undefined),
    [favoriteKind, toggleFavorite, favorites.ids],
  )
  const selectedValues = useMemo<readonly string[]>(
    () => (props.multiple === true ? props.values : props.value === '' ? [] : [props.value]),
    [props],
  )
  const value = props.multiple === true ? '' : props.value
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({ position: 'fixed' })
  const popupId = useId()

  const rows = useMemo(
    () =>
      buildTreeSelectRows({
        categories,
        selectedValue: value,
        selectedValues: isMulti ? selectedValues : undefined,
        query,
        openOverrides,
        favoriteValues,
      }),
    [categories, value, isMulti, selectedValues, query, openOverrides, favoriteValues],
  )

  // 先頭に固定する候補(計画Issue #236)。選択肢に無い値は出さず、検索中は語に合うものだけ残す
  const pinnedCandidates = useMemo(
    () =>
      isMulti
        ? []
        : (pinnedValues ?? []).flatMap((pinned) => {
            const name = findItemName(categories, pinned)
            return name !== undefined && matchesSearch(name, query) ? [{ value: pinned, name }] : []
          }),
    [isMulti, pinnedValues, categories, query],
  )

  const selectedNames = useMemo(
    () =>
      selectedValues.map(
        (selectedValue) => leadingOptions?.find((option) => option.value === selectedValue)?.label ?? nameOfValue(categories, selectedValue),
      ),
    [categories, selectedValues, leadingOptions],
  )
  const selectedText =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames[0]} ほか${selectedNames.length - 1}件`
  // 複数選択のときは、ホバーですべての選択を確認できるようにする
  const selectedTitle = selectedNames.length > 1 ? selectedNames.join('、') : undefined

  // ポップアップは画面全体に固定して描画する。表のようにoverflowで切れる親の中でも見切れないようにするため。
  // ボタンの直下に出し、下に十分な余白が無く上の方が広ければ上に出す。スクロール・リサイズに追従する。
  useLayoutEffect(() => {
    if (!isOpen) return
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(300, window.innerWidth * 0.8)
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8))
      const below = window.innerHeight - trigger.bottom - 12
      const above = trigger.top - 12
      const openUp = below < 280 && above > below
      setPopupStyle(
        openUp
          ? { position: 'fixed', left, bottom: window.innerHeight - trigger.top + 4, maxHeight: above }
          : { position: 'fixed', left, top: trigger.bottom + 4, maxHeight: Math.max(below, 160) },
      )
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    searchRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setIsOpen(false)
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
    if (props.multiple === true) {
      // 複数選択は選んでも閉じない。選択中なら外し、そうでなければ末尾に足す
      props.onValuesChange(
        next === ''
          ? []
          : props.values.includes(next)
            ? props.values.filter((current) => current !== next)
            : [...props.values, next],
      )
      return
    }
    props.onChange(next)
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
    if (event.key === 'Enter' && event.target === searchRef.current) {
      // 検索欄でのEnterは、フォームの送信に使わせない。日本語の変換確定のEnter(isComposing・keyCode 229)は何もしない。
      // 検索で候補が1件に絞れていれば、それを選ぶ(計画Issue #233)
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      if (query.trim() === '') return
      const candidates = [...new Set(rows.flatMap((row) => (row.type === 'item' ? [row.value] : [])))]
      if (candidates.length === 1) choose(candidates[0])
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const focusables: HTMLElement[] = [
      ...(searchRef.current ? [searchRef.current] : []),
      // ★のボタンはたどらない(項目の行だけをたどる。★はTabで届く)
      ...Array.from(listRef.current?.querySelectorAll<HTMLElement>('button:not([data-favorite-toggle])') ?? []),
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
        className={`tree-select__trigger${selectedValues.length === 0 ? ' tree-select__trigger--empty' : ''}`}
        title={selectedTitle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
        aria-label={`${label}: ${selectedText}`}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
      >
        <span className="tree-select__trigger-text">{selectedText}</span>
        <span aria-hidden="true" className="tree-select__caret">
          ▾
        </span>
      </button>
      {isOpen &&
        createPortal(
        <div
          ref={popupRef}
          style={popupStyle}
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
          {onCreate !== undefined && (
            // 一覧が長くてもスクロールせずに押せるよう、スクロールする一覧の外の検索欄の直下に固定する(計画Issue #218)
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
          <div className="tree-select__list" ref={listRef}>
            {pinnedCandidates.length > 0 && (
              <>
                {pinnedLabel !== undefined && <div className="tree-select__category">{pinnedLabel}</div>}
                {pinnedCandidates.map((candidate) => (
                  <button
                    key={`p:${candidate.value}`}
                    type="button"
                    className={`tree-select__item${value === candidate.value ? ' tree-select__item--selected' : ''}`}
                    style={{ paddingLeft: 8 }}
                    onClick={() => choose(candidate.value)}
                  >
                    {candidate.name}
                  </button>
                ))}
              </>
            )}
            {leadingOptions?.map((option) => (
              <button
                key={`l:${option.value}`}
                type="button"
                className={`tree-select__item${value === option.value ? ' tree-select__item--selected' : ''}`}
                style={{ paddingLeft: 8 }}
                aria-current={value === option.value ? 'true' : undefined}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            ))}
            {emptyLabel !== undefined && query.trim() === '' && (
              <button
                type="button"
                className={`tree-select__item${selectedValues.length === 0 ? ' tree-select__item--selected' : ''}`}
                style={{ paddingLeft: 8 }}
                aria-current={selectedValues.length === 0 ? 'true' : undefined}
                onClick={() => choose('')}
              >
                {emptyLabel}
              </button>
            )}
            {rows.map((row, rowIndex) => {
              if (row.type === 'category') {
                return (
                  <div key={`c:${row.name}`} className="tree-select__category">
                    {row.name}
                  </div>
                )
              }
              if (row.type === 'context') {
                return (
                  // 検索で絞り落とされた親。階層が追えるように残す(押せない、計画Issue #233)
                  <div key={`x:${rowIndex}`} className="tree-select__context" style={{ paddingLeft: row.indent }}>
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
                        className={`tree-select__select-all${row.isSelected ? ' tree-select__select-all--on' : ''}`}
                        aria-label={`${row.name}をすべて選ぶ`}
                        aria-pressed={isMulti ? row.isSelected : undefined}
                        onClick={() => choose(row.value)}
                      >
                        すべて
                      </button>
                    )}
                  </div>
                )
              }
              return (
                <div key={`i:${row.section}:${row.value}`} className="tree-select__item-row">
                  {row.fold !== undefined && (
                    // 階層つきの項目の開閉(計画Issue #234)。子を持つ項目だけが押せる。名前を押すと選択、この印を押すと開閉
                    <span className="tree-select__fold-slot" style={{ paddingLeft: row.indent }}>
                      {row.fold === 'leaf' ? (
                        <span className="tree-select__fold-spacer" aria-hidden="true" />
                      ) : (
                        <button
                          type="button"
                          className="tree-select__fold"
                          aria-label={`${row.name}を${row.fold === 'open' ? '閉じる' : '開く'}`}
                          aria-expanded={row.fold === 'open'}
                          onClick={() => toggleGroup(`h:${row.value}`, row.fold === 'open')}
                        >
                          {row.fold === 'open' ? '▾' : '▸'}
                        </button>
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`tree-select__item${row.isSelected ? ' tree-select__item--selected' : ''}${isMulti ? ' tree-select__item--multi' : ''}`}
                    style={{ paddingLeft: row.fold !== undefined ? 4 : row.indent }}
                    aria-current={!isMulti && row.isSelected ? 'true' : undefined}
                    aria-pressed={isMulti ? row.isSelected : undefined}
                    data-via-group={isMulti && row.isViaGroup ? 'true' : undefined}
                    onClick={() => choose(row.value)}
                  >
                    <span>{row.name}</span>
                    {isMulti && (row.isSelected || row.isViaGroup) && (
                      <span aria-hidden="true" className="tree-select__check">
                        ✓
                      </span>
                    )}
                  </button>
                  {favoriteKind !== undefined && toggleFavorite !== undefined && /^\d+$/.test(row.value) && (
                    // ★は項目の選択とは別のボタン(押しても選ばず、閉じない)。計画Issue #231 フェーズ4
                    <button
                      type="button"
                      className={`tree-select__star${row.isFavorite ? ' tree-select__star--on' : ''}`}
                      data-favorite-toggle="true"
                      aria-pressed={row.isFavorite}
                      aria-label={`${row.name}をお気に入り${row.isFavorite ? 'から外す' : 'に追加'}`}
                      onClick={() => void toggleFavorite(favoriteKind, Number(row.value))}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3L10 14.5l-4.6 2.6.9-5.3L2.5 8.1l5.2-.7z" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
            {rows.length === 0 && <p className="tree-select__empty">該当する項目がありません</p>}
          </div>
        </div>,
        document.body,
        )}
    </div>
  )
}
