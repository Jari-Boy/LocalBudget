import type {
  CreateProjectGroupInput,
  ProjectGroup,
  UpdateProjectGroupInput,
} from './ProjectGroup'

/**
 * プロジェクトグループ(project_groups)の永続化を担うRepositoryのポート(インターフェース)。
 * 子グループ・所属プロジェクトが存在するグループの物理削除禁止・グループ名のユニーク制約は
 * DDL側(docs/schema/projects.sql)で強制され、実装(インフラ層)は制約違反時の例外を
 * そのまま伝播させる。親グループ変更時の循環参照検証はisDescendantGroup(ドメイン層の
 * 純粋関数)を用いて実装側で行う。
 */
export interface ProjectGroupRepository {
  create(input: CreateProjectGroupInput): ProjectGroup
  findById(id: number): ProjectGroup | null
  findAll(): ProjectGroup[]
  update(id: number, input: UpdateProjectGroupInput): ProjectGroup
  delete(id: number): void
  deactivate(id: number): ProjectGroup
}
