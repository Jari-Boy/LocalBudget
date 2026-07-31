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
}
