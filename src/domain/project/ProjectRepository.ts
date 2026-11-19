import type { CreateProjectInput, Project, UpdateProjectInput } from './Project'

/**
 * プロジェクト(projects)の永続化を担うRepositoryのポート(インターフェース)。
 * kindのCHECK制約・紐づく仕訳明細が存在するプロジェクトの物理削除禁止トリガー等の
 * ドメインルールはDDL側(docs/schema/projects.sql)で強制されるため、
 * 実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる
 * (docs/domain/projects.md参照)。
 */
export interface ProjectRepository {
  create(input: CreateProjectInput): Project
  findById(id: number): Project | null
  findAll(): Project[]
  update(id: number, input: UpdateProjectInput): Project
  delete(id: number): void
  deactivate(id: number): Project
  activate(id: number): Project
  /**
   * お気に入り(計画Issue #231 フェーズ4)のidの一覧(id順)。選択欄の先頭の「★ お気に入り」に出す。
   * 無効のプロジェクトも、お気に入りの状態は保つ(選択欄での表示は、従来どおり、無効なものを選択中以外は出さない)
   */
  findFavoriteIds(): number[]
  /** お気に入りの付け外し。表示専用で、ほかの項目は変えない。存在しないidを指定しても何も起きない */
  setFavorite(id: number, isFavorite: boolean): void
}
