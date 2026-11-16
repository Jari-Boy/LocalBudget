import type { Database } from 'sql.js'
import type { CreateKeywordRuleInput, KeywordRule, UpdateKeywordRuleInput } from '../../domain/keyword-rule/KeywordRule'
import type { KeywordRuleRepository } from '../../domain/keyword-rule/KeywordRuleRepository'

/** キーワードルール(keyword_rules)のsql.js実装。制約はDDL側で強制し、違反の例外はそのまま伝播する */
export class SqlJsKeywordRuleRepository implements KeywordRuleRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateKeywordRuleInput): KeywordRule {
    this.db.run('INSERT INTO keyword_rules (pattern, counterparty_id, account_id) VALUES (?, ?, ?)', [
      input.pattern,
      input.counterpartyId ?? null,
      input.accountId ?? null,
    ])
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    return this.findById(id)!
  }

  findById(id: number): KeywordRule | null {
    return this.query('SELECT * FROM keyword_rules WHERE id = ?', [id])[0] ?? null
  }

  findAll(): KeywordRule[] {
    return this.query('SELECT * FROM keyword_rules ORDER BY id', [])
  }

  findByCounterparty(counterpartyId: number): KeywordRule[] {
    return this.query('SELECT * FROM keyword_rules WHERE counterparty_id = ? ORDER BY id', [counterpartyId])
  }

  findByAccount(accountId: number): KeywordRule[] {
    return this.query('SELECT * FROM keyword_rules WHERE account_id = ? ORDER BY id', [accountId])
  }

  update(id: number, input: UpdateKeywordRuleInput): KeywordRule {
    const current = this.findById(id)
    if (!current) throw new Error(`keyword rule not found: ${id}`)
    this.db.run('UPDATE keyword_rules SET pattern = ?, counterparty_id = ?, account_id = ? WHERE id = ?', [
      input.pattern ?? current.pattern,
      input.counterpartyId === undefined ? current.counterpartyId : input.counterpartyId,
      input.accountId === undefined ? current.accountId : input.accountId,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM keyword_rules WHERE id = ?', [id])
  }

  findMatching(normalizedText: string): KeywordRule[] {
    return this.query("SELECT * FROM keyword_rules WHERE ? LIKE '%' || pattern || '%' ORDER BY id", [normalizedText])
  }

  private query(sql: string, params: (string | number)[]): KeywordRule[] {
    const [result] = this.db.exec(sql, params)
    if (!result) return []
    return result.values.map((values) => {
      const get = <T,>(name: string): T => values[result.columns.indexOf(name)] as T
      return {
        id: get<number>('id'),
        pattern: get<string>('pattern'),
        counterpartyId: get<number | null>('counterparty_id'),
        accountId: get<number | null>('account_id'),
        createdAt: get<string>('created_at'),
      }
    })
  }
}
