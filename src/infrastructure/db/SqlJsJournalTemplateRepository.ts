import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import type { JournalTemplate, CreateJournalTemplateInput, JournalTemplateLine, JournalTemplateLineInput, UpdateJournalTemplateInput } from '../../domain/journal-template/JournalTemplate'
import type { JournalTemplateRepository } from '../../domain/journal-template/JournalTemplateRepository'
import { InvalidJournalTemplateError } from '../../domain/journal-template/InvalidJournalTemplateError'
import { assertJournalBalance } from '../../domain/journal/assertJournalBalance'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'

/**
 * JournalTemplateRepository(ドメイン層のポート)のsql.js実装(計画Issue #201)。
 * テンプレートと行を1つの単位(SAVEPOINT)で書き込み、検証に失敗したら何も残さない。
 * 書き込み前の検証: 名称が空でない・行が2行以上で借方と貸方の両方がある・金額は正の整数か空欄・
 * 全行の金額があるときだけ貸借の一致(assertJournalBalance)・精算バッチは立替金/未払金の行だけ。
 * 取引先がPL科目以外の行に付くことと名称の重複は、DDL(docs/schema/journal_templates.sql)が拒否し、
 * そのsql.js例外はそのまま伝播する。sortOrder省略時は、同じ入れ物(グループ、未分類なら最上位)の
 * 既存のサブグループ・直属テンプレートのどちらよりも後ろ(末尾)に自動採番する。
 */
export class SqlJsJournalTemplateRepository implements JournalTemplateRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateJournalTemplateInput): JournalTemplate {
    assertValidTemplate(input.name, input.lines)
    this.assertSettlementBatchLines(input.lines)
    const groupId = input.groupId ?? null
    const sortOrder = input.sortOrder ?? this.nextSortOrder(groupId)

    return this.inSavepoint(() => {
      this.db.run(
        `INSERT INTO journal_templates
          (name, memo, bookkeeper_household_member_id, journal_template_group_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [input.name, input.memo ?? null, input.bookkeeperHouseholdMemberId ?? null, groupId, sortOrder],
      )
      const id = lastInsertRowId(this.db)
      this.insertLines(id, input.lines)
      return this.findById(id)!
    })
  }

  findById(id: number): JournalTemplate | null {
    const [result] = this.db.exec('SELECT * FROM journal_templates WHERE id = ?', [id])
    if (!result) return null
    return mapRowToTemplate(result.columns, result.values[0], this.findLines(id))
  }

  findAll(): JournalTemplate[] {
    const [result] = this.db.exec('SELECT * FROM journal_templates ORDER BY id')
    if (!result) return []
    return result.values.map((values) => {
      const id = values[result.columns.indexOf('id')] as number
      return mapRowToTemplate(result.columns, values, this.findLines(id))
    })
  }

  update(id: number, input: UpdateJournalTemplateInput): JournalTemplate {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`journal template not found: ${id}`)
    }

    const name = input.name ?? current.name
    const lines = input.lines ?? current.lines.map(toLineInput)
    assertValidTemplate(name, lines)
    if (input.lines !== undefined) this.assertSettlementBatchLines(input.lines)

    const nextGroupId = input.groupId === undefined ? current.groupId : input.groupId
    const isMoving = nextGroupId !== current.groupId
    const sortOrder =
      input.sortOrder !== undefined
        ? input.sortOrder
        : isMoving
          ? this.nextSortOrder(nextGroupId, id)
          : current.sortOrder

    return this.inSavepoint(() => {
      this.db.run(
        `UPDATE journal_templates SET
          name = ?, memo = ?, bookkeeper_household_member_id = ?, journal_template_group_id = ?, sort_order = ?
         WHERE id = ?`,
        [
          name,
          input.memo === undefined ? current.memo : input.memo,
          input.bookkeeperHouseholdMemberId === undefined
            ? current.bookkeeperHouseholdMemberId
            : input.bookkeeperHouseholdMemberId,
          nextGroupId,
          sortOrder,
          id,
        ],
      )
      if (input.lines !== undefined) {
        this.db.run('DELETE FROM journal_template_lines WHERE journal_template_id = ?', [id])
        this.insertLines(id, input.lines)
      }
      return this.findById(id)!
    })
  }

  delete(id: number): void {
    this.db.run('DELETE FROM journal_templates WHERE id = ?', [id])
  }

  deactivate(id: number): JournalTemplate {
    this.db.run('UPDATE journal_templates SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  activate(id: number): JournalTemplate {
    this.db.run('UPDATE journal_templates SET is_active = 1 WHERE id = ?', [id])
    return this.findById(id)!
  }

  /** 精算バッチはシステム管理の立替金・未払金の科目の行にだけ設定できる(journal_linesと同じ検証) */
  private assertSettlementBatchLines(lines: readonly JournalTemplateLineInput[]): void {
    for (const line of lines) {
      if (line.settlementBatchId === undefined || line.settlementBatchId === null) continue
      if (line.accountId === undefined || line.accountId === null) continue
      const [result] = this.db.exec('SELECT category, is_system_managed FROM accounts WHERE id = ?', [line.accountId])
      const row = result?.values[0]
      if (!row) continue
      if (!isSettlementBatchTaggableAccount({ category: row[0] as AccountCategory, isSystemManaged: row[1] === 1 })) {
        throw new SettlementBatchOnNonAdvanceAccountError(line.accountId)
      }
    }
  }

  private insertLines(templateId: number, lines: readonly JournalTemplateLineInput[]): void {
    lines.forEach((line, index) => {
      this.db.run(
        `INSERT INTO journal_template_lines
          (journal_template_id, line_no, side, account_id, amount, project_id, household_member_id, counterparty_id, settlement_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          index + 1,
          line.side,
          line.accountId ?? null,
          line.amount ?? null,
          line.projectId ?? null,
          line.householdMemberId ?? null,
          line.counterpartyId ?? null,
          line.settlementBatchId ?? null,
        ],
      )
    })
  }

  private findLines(templateId: number): JournalTemplateLine[] {
    const [result] = this.db.exec(
      'SELECT * FROM journal_template_lines WHERE journal_template_id = ? ORDER BY line_no',
      [templateId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToLine(result.columns, values))
  }

  /**
   * 指定した入れ物(groupId。nullなら最上位=未分類)に既に存在するサブグループ・直属テンプレートの
   * sort_orderの最大値+1を返す。excludeTemplateIdは自分自身を候補から除外するために使う(update時)。
   */
  private nextSortOrder(groupId: number | null, excludeTemplateId?: number): number {
    const excludeClause = excludeTemplateId !== undefined ? ' AND id != ?' : ''
    const excludeParams = excludeTemplateId !== undefined ? [excludeTemplateId] : []
    const templateRows =
      groupId === null
        ? this.db.exec(
            `SELECT MAX(sort_order) FROM journal_templates WHERE journal_template_group_id IS NULL${excludeClause}`,
            excludeParams,
          )
        : this.db.exec(
            `SELECT MAX(sort_order) FROM journal_templates WHERE journal_template_group_id = ?${excludeClause}`,
            [groupId, ...excludeParams],
          )
    const groupRows =
      groupId === null
        ? this.db.exec('SELECT MAX(sort_order) FROM journal_template_groups WHERE parent_group_id IS NULL')
        : this.db.exec('SELECT MAX(sort_order) FROM journal_template_groups WHERE parent_group_id = ?', [groupId])

    const templateMax = (templateRows[0]?.values[0]?.[0] as number | null) ?? null
    const groupMax = (groupRows[0]?.values[0]?.[0] as number | null) ?? null
    return Math.max(templateMax ?? -1, groupMax ?? -1) + 1
  }

  /** テンプレートと行を1つの単位で書き込む(途中で失敗したら、テンプレートも行も残さない) */
  private inSavepoint<T>(write: () => T): T {
    this.db.run('SAVEPOINT journal_template_write')
    try {
      const result = write()
      this.db.run('RELEASE journal_template_write')
      return result
    } catch (error) {
      this.db.run('ROLLBACK TO journal_template_write')
      this.db.run('RELEASE journal_template_write')
      throw error
    }
  }
}

/**
 * テンプレートの内容の検証(書き込み前)。名称が空でない、2行以上で借方と貸方の両方がある、
 * 金額は正の整数か空欄、全行の金額があるときだけ貸借の一致(assertJournalBalance)。
 * 一部の行が空欄のときは、起票時に金額が決まるため貸借の一致は確認しない。
 */
function assertValidTemplate(name: string, lines: readonly JournalTemplateLineInput[]): void {
  if (name.trim() === '') {
    throw new InvalidJournalTemplateError('journal template name must not be blank')
  }
  if (lines.length < 2) {
    throw new InvalidJournalTemplateError(`journal template must have at least 2 lines: got ${lines.length}`)
  }
  if (!lines.some((l) => l.side === 'debit') || !lines.some((l) => l.side === 'credit')) {
    throw new InvalidJournalTemplateError('journal template must have both debit and credit lines')
  }
  for (const line of lines) {
    const amount = line.amount ?? null
    if (amount !== null && (!Number.isInteger(amount) || amount <= 0)) {
      throw new InvalidJournalTemplateError(`journal template line amount must be a positive integer or blank: ${amount}`)
    }
  }
  if (lines.every((l) => (l.amount ?? null) !== null)) {
    assertJournalBalance(lines.map((l) => ({ side: l.side, amount: l.amount as number })))
  }
}

function toLineInput(line: JournalTemplateLine): JournalTemplateLineInput {
  return {
    side: line.side,
    accountId: line.accountId,
    amount: line.amount,
    projectId: line.projectId,
    householdMemberId: line.householdMemberId,
    counterpartyId: line.counterpartyId,
    settlementBatchId: line.settlementBatchId,
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToTemplate(columns: string[], values: unknown[], lines: JournalTemplateLine[]): JournalTemplate {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    memo: get<string | null>('memo'),
    bookkeeperHouseholdMemberId: get<number | null>('bookkeeper_household_member_id'),
    groupId: get<number | null>('journal_template_group_id'),
    sortOrder: get<number>('sort_order'),
    isActive: get<number>('is_active') !== 0,
    lines,
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}

function mapRowToLine(columns: string[], values: unknown[]): JournalTemplateLine {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    lineNo: get<number>('line_no'),
    side: get<'debit' | 'credit'>('side'),
    accountId: get<number | null>('account_id'),
    amount: get<number | null>('amount'),
    projectId: get<number | null>('project_id'),
    householdMemberId: get<number | null>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    settlementBatchId: get<number | null>('settlement_batch_id'),
  }
}
