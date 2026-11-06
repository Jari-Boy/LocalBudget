import type { Database } from 'sql.js'
import type { CreateProjectInput, Project, UpdateProjectInput } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'

/**
 * ProjectRepository(ドメイン層のポート)のsql.js実装。
 * kindは持たない(プロジェクトはイベント専用、計画Issue #133)。紐づく仕訳明細が存在する
 * プロジェクトの物理削除禁止トリガー等のドメインルールはDDL側のトリガー
 * (docs/schema/projects.sql)で強制されるため、ここでは制約違反時にsql.jsの例外がそのまま
 * 呼び出し元に伝播する(docs/domain/projects.md参照)。
 */
export class SqlJsProjectRepository implements ProjectRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateProjectInput): Project {
    this.db.run('INSERT INTO projects (name, project_group_id, sort_order) VALUES (?, ?, ?)', [
      input.name,
      input.projectGroupId ?? null,
      input.sortOrder ?? 0,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): Project | null {
    const [result] = this.db.exec('SELECT * FROM projects WHERE id = ?', [id])
    if (!result) return null
    return mapRowToProject(result.columns, result.values[0])
  }

  findAll(): Project[] {
    const [result] = this.db.exec('SELECT * FROM projects ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToProject(result.columns, values))
  }

  update(id: number, input: UpdateProjectInput): Project {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`project not found: ${id}`)
    }

    this.db.run('UPDATE projects SET name = ?, project_group_id = ?, sort_order = ? WHERE id = ?', [
      input.name ?? current.name,
      input.projectGroupId === undefined ? current.projectGroupId : input.projectGroupId,
      input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
  }

  deactivate(id: number): Project {
    this.db.run('UPDATE projects SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  activate(id: number): Project {
    this.db.run('UPDATE projects SET is_active = 1 WHERE id = ?', [id])
    return this.findById(id)!
  }
}

function sqlToBool(value: number): boolean {
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToProject(columns: string[], values: unknown[]): Project {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    projectGroupId: get<number | null>('project_group_id'),
    sortOrder: get<number>('sort_order'),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
