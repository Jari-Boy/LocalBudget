import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** お気に入りにできるもの。選択欄(TreeSelect)の favoriteKind と、マスタ画面の★で、どれのお気に入りかを指す */
export type FavoriteKind = 'account' | 'counterparty' | 'project'

/** お気に入りの読み書きだけを持つRepositoryの形(科目・取引先・プロジェクトのRepositoryがそのまま満たす) */
export interface FavoriteRepository {
  findFavoriteIds(): number[] | Promise<number[]>
  setFavorite(id: number, isFavorite: boolean): void | Promise<void>
}

type FavoriteIds = Record<FavoriteKind, ReadonlySet<number>>

const EMPTY_IDS: FavoriteIds = { account: new Set(), counterparty: new Set(), project: new Set() }

interface FavoritesValue {
  ids: FavoriteIds
  /** 付け外し。画面にすぐ反映し、保存に失敗したら元の状態へ戻す。プロバイダーが無いとき(既存の画面・テスト)はundefined */
  toggle: ((kind: FavoriteKind, id: number) => Promise<void>) | undefined
}

const FavoritesContext = createContext<FavoritesValue>({ ids: EMPTY_IDS, toggle: undefined })

export interface FavoritesProviderProps {
  repositories: Record<FavoriteKind, FavoriteRepository>
  /** 変わると、お気に入りを読み直す(別の画面での統合・削除などで変わった状態に追従するため。例: 現在のパス) */
  refreshKey?: unknown
  children: ReactNode
}

/**
 * お気に入り(計画Issue #231 フェーズ4)の状態を、画面全体で1か所に持つ。科目・取引先・プロジェクトのお気に入りのidを読み込み、
 * 選択欄(TreeSelect、約15か所)とマスタ画面の★が同じ状態を見るので、どこで付け外しても、ほかの選択欄にすぐ反映される。
 * 付け外しは、画面に先に反映してから保存し(楽観的更新)、保存に失敗したときは読み直して元に戻す。
 */
export function FavoritesProvider({ repositories, refreshKey, children }: FavoritesProviderProps) {
  const [ids, setIds] = useState<FavoriteIds>(EMPTY_IDS)
  // 付け外しの向きを、描画を待たずに最新の状態から決めるための写し(続けて押しても、前の押下の結果を踏まえる)
  const idsRef = useRef<FavoriteIds>(EMPTY_IDS)
  idsRef.current = ids
  // 付け外しの途中に、古い読み込みの結果で状態を上書きしないための世代
  const generation = useRef(0)

  const load = useCallback(async () => {
    const current = ++generation.current
    const [account, counterparty, project] = await Promise.all([
      Promise.resolve(repositories.account.findFavoriteIds()),
      Promise.resolve(repositories.counterparty.findFavoriteIds()),
      Promise.resolve(repositories.project.findFavoriteIds()),
    ])
    if (current === generation.current) {
      setIds({ account: new Set(account), counterparty: new Set(counterparty), project: new Set(project) })
    }
  }, [repositories])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const toggle = useCallback(
    async (kind: FavoriteKind, id: number) => {
      generation.current++
      const set = new Set(idsRef.current[kind])
      const next = !set.has(id)
      if (next) set.add(id)
      else set.delete(id)
      idsRef.current = { ...idsRef.current, [kind]: set }
      setIds(idsRef.current)
      try {
        await Promise.resolve(repositories[kind].setFavorite(id, next))
      } catch {
        // 保存できなかったので、保存されている状態に戻す
        await load()
      }
    },
    [repositories, load],
  )

  const value = useMemo(() => ({ ids, toggle }), [ids, toggle])
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

/** お気に入りの状態と付け外し。プロバイダーの外では、お気に入りは無く、付け外しもできない */
export function useFavorites(): FavoritesValue {
  return useContext(FavoritesContext)
}
