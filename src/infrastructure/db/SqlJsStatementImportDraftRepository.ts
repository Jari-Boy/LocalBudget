import type { Database } from 'sql.js'
import type {
  SaveStatementImportDraftInput,
  StatementImportDraft,
  StatementImportDraftFile,
  StatementImportDraftRowInput,
  StatementImportDraftSummary,
} from '../../domain/statement-import/StatementImportDraft'
import type { StatementImportDraftRepository } from '../../domain/statement-import/StatementImportDraftRepository'

/**
 * StatementImportDraftRepository(明細取込の一時保存、計画Issue #231 フェーズ3)のsql.js実装。
 * 一時保存は取込先の科目ごとに1つ(DDL側のUNIQUE制約、docs/schema/statement_import.sql)。保存は、
 * 本体の行とCSVの行を1つの単位(SAVEPOINT)で書き、途中で失敗したときは、本体もCSVも残さない。
 * 同じ取込先の一時保存があるときは、行を作り直さず本体をUPDATEしてCSVを入れ替え、idと作成日時を保つ。
 */
export class SqlJsStatementImportDraftRepository implements StatementImportDraftRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  findSummaries(): StatementImportDraftSummary[] {
    const [result] = this.db.exec('SELECT * FROM statement_import_drafts ORDER BY updated_at DESC, id DESC')
    if (!result) return []
    return result.values.map((row) => this.toSummary(result.columns, row))
  }

  findByAccountId(accountId: number): StatementImportDraftSummary | null {
    const [result] = this.db.exec('SELECT * FROM statement_import_drafts WHERE target_account_id = ?', [accountId])
    if (!result) return null
    return this.toSummary(result.columns, result.values[0])
  }

  findById(id: number): StatementImportDraft | null {
    const [result] = this.db.exec('SELECT * FROM statement_import_drafts WHERE id = ?', [id])
    if (!result) return null
    const get = <T,>(name: string): T => result.values[0][result.columns.indexOf(name)] as T
    return {
      id: get<number>('id'),
      targetAccountId: get<number>('target_account_id'),
      definitionId: get<number | null>('definition_id'),
      ownerMemberId: get<number | null>('owner_member_id'),
      files: this.findFiles(id),
      rowInputs: JSON.parse(get<string>('row_inputs')) as Record<string, StatementImportDraftRowInput>,
      totalRows: get<number>('total_rows'),
      filledRows: get<number>('filled_rows'),
      createdAt: get<string>('created_at'),
      updatedAt: get<string>('updated_at'),
    }
  }

  save(input: SaveStatementImportDraftInput): StatementImportDraft {
    const id = this.inSavepoint(() => {
      const existing = this.db.exec('SELECT id FROM statement_import_drafts WHERE target_account_id = ?', [
        input.targetAccountId,
      ])[0]?.values[0]?.[0] as number | undefined
      const rowInputs = JSON.stringify(input.rowInputs)
      let draftId: number
      if (existing === undefined) {
        this.db.run(
          `INSERT INTO statement_import_drafts
             (target_account_id, definition_id, owner_member_id, row_inputs, total_rows, filled_rows)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [input.targetAccountId, input.definitionId, input.ownerMemberId, rowInputs, input.totalRows, input.filledRows],
        )
        draftId = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
      } else {
        draftId = existing
        this.db.run(
          `UPDATE statement_import_drafts
              SET definition_id = ?, owner_member_id = ?, row_inputs = ?, total_rows = ?, filled_rows = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
          [input.definitionId, input.ownerMemberId, rowInputs, input.totalRows, input.filledRows, draftId],
        )
        this.db.run('DELETE FROM statement_import_draft_files WHERE draft_id = ?', [draftId])
      }
      input.files.forEach((file, order) => {
        this.db.run(
          `INSERT INTO statement_import_draft_files (draft_id, file_order, file_name, content, is_checked)
           VALUES (?, ?, ?, ?, ?)`,
          [draftId, order, file.fileName, file.bytes, file.isChecked ? 1 : 0],
        )
      })
      return draftId
    })
    return this.findById(id)!
  }

  delete(id: number): void {
    // CSVの行は、DDLのON DELETE CASCADEで一緒に消える
    this.db.run('DELETE FROM statement_import_drafts WHERE id = ?', [id])
  }

  private findFiles(draftId: number): StatementImportDraftFile[] {
    const [result] = this.db.exec(
      'SELECT file_name, content, is_checked FROM statement_import_draft_files WHERE draft_id = ? ORDER BY file_order',
      [draftId],
    )
    if (!result) return []
    return result.values.map(([fileName, content, isChecked]) => ({
      fileName: fileName as string,
      bytes: content as Uint8Array,
      isChecked: (isChecked as number) !== 0,
    }))
  }

  /** 要約の1行。CSVの中身は読まず、ファイル名だけを集める */
  private toSummary(columns: string[], values: unknown[]): StatementImportDraftSummary {
    const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
    const id = get<number>('id')
    const names = this.db.exec('SELECT file_name FROM statement_import_draft_files WHERE draft_id = ? ORDER BY file_order', [id])[0]
    return {
      id,
      targetAccountId: get<number>('target_account_id'),
      definitionId: get<number | null>('definition_id'),
      fileNames: (names?.values ?? []).map((row) => row[0] as string),
      totalRows: get<number>('total_rows'),
      filledRows: get<number>('filled_rows'),
      createdAt: get<string>('created_at'),
      updatedAt: get<string>('updated_at'),
    }
  }

  private inSavepoint<T>(write: () => T): T {
    this.db.run('SAVEPOINT statement_import_draft_write')
    try {
      const result = write()
      this.db.run('RELEASE statement_import_draft_write')
      return result
    } catch (error) {
      this.db.run('ROLLBACK TO statement_import_draft_write')
      this.db.run('RELEASE statement_import_draft_write')
      throw error
    }
  }
}
