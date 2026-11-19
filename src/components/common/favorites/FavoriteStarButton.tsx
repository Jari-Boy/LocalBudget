import { useFavorites, type FavoriteKind } from './FavoritesContext'
import './FavoriteStarButton.css'

export interface FavoriteStarButtonProps {
  kind: FavoriteKind
  id: number
  /** 名称(ボタンの名前に使う) */
  name: string
}

/**
 * マスタ画面の行の名称の左に置く、お気に入りの★のボタン(計画Issue #231 フェーズ4)。押すとお気に入りを付け外しして保存する
 * (状態は、選択欄と同じFavoritesProviderが持つので、押すとほかの画面の選択欄にもすぐ反映される)。
 * プロバイダーが無いとき(既存の画面・テスト)は、何も出さない。
 */
export function FavoriteStarButton({ kind, id, name }: FavoriteStarButtonProps) {
  const favorites = useFavorites()
  const toggle = favorites.toggle
  if (toggle === undefined) return null
  const isFavorite = favorites.ids[kind].has(id)
  return (
    <button
      type="button"
      className={`favorite-star${isFavorite ? ' favorite-star--on' : ''}`}
      aria-pressed={isFavorite}
      aria-label={`${name}をお気に入り${isFavorite ? 'から外す' : 'に追加'}`}
      onClick={() => void toggle(kind, id)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3L10 14.5l-4.6 2.6.9-5.3L2.5 8.1l5.2-.7z" />
      </svg>
    </button>
  )
}

/** ★を出さない行(システム管理の科目)で、名称の位置をそろえるための空き。プロバイダーが無いときは何も出さない */
export function FavoriteStarPlaceholder() {
  const favorites = useFavorites()
  if (favorites.toggle === undefined) return null
  return <span className="favorite-star-placeholder" aria-hidden="true" />
}
