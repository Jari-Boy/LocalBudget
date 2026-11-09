import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { TreeSelect } from '../tree-select/TreeSelect'
import type { TreeSelectCategory } from '../tree-select/treeSelectModel'
import {
  countActiveConditions,
  getBatchValue,
  getSingleValue,
  getTreeValue,
  NO_BATCH_VALUE,
  setAmount,
  setBatchValue,
  setDate,
  setMemo,
  setSingleValue,
  setTreeValue,
} from './journalFilterModel'
import './JournalFilterPanel.css'

/** 平らな選択肢(世帯メンバー・精算バッチ・出どころ)。valueは選択ツリーの値と同じ文字列。 */
export interface JournalFilterChoice {
  value: string
  name: string
}

export interface JournalFilterOptions {
  accountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  members: readonly JournalFilterChoice[]
  batches: readonly JournalFilterChoice[]
  sourceTypes: readonly JournalFilterChoice[]
}

/** 隠せる項目(計画Issue #153。精算の候補探しでは、精算バッチで絞り込まない) */
export type JournalFilterFieldKey = 'account' | 'counterparty' | 'project' | 'member' | 'batch' | 'source'

export interface JournalFilterPanelProps {
  filter: JournalEntryFilter
  onChange: (filter: JournalEntryFilter) => void
  options: JournalFilterOptions
  /** 絞り込み後の件数。渡すと右下に表示する */
  resultCount?: number
  /** 出さない項目。省略時はすべて出す */
  hide?: readonly JournalFilterFieldKey[]
}

const flat = (choices: readonly JournalFilterChoice[]): TreeSelectCategory[] => [
  {
    key: 'flat',
    name: '',
    nodes: choices.map((c) => ({ kind: 'item' as const, value: c.value, name: c.name, isActive: true })),
  },
]

/**
 * 仕訳の絞り込みパネル(計画Issue #150)。文字検索・期間・金額・科目・取引先・プロジェクト・
 * 世帯メンバー・精算バッチ・出どころを最初からすべて並べる(「条件を追加」方式にしない)。
 * 条件の状態は呼び出し側が持つ制御コンポーネントで、常時表示でもポップアップ
 * (JournalFilterPopup)の中でも使える。絞り込みの実行はドメイン層(filterJournalEntries)の責務で、
 * ここはJournalEntryFilterの生成だけを行う。
 */
export function JournalFilterPanel({ filter, onChange, options, resultCount, hide = [] }: JournalFilterPanelProps) {
  const activeCount = countActiveConditions(filter)
  const shows = (key: JournalFilterFieldKey) => !hide.includes(key)
  const batchCategories = flat([{ value: NO_BATCH_VALUE, name: '未割当' }, ...options.batches])

  return (
    <div className="journal-filter" role="search" aria-label="仕訳の絞り込み">
      <div className="journal-filter__row">
        <input
          type="search"
          className="journal-filter__text"
          aria-label="摘要で検索"
          placeholder="摘要で検索"
          value={filter.memo ?? ''}
          onChange={(event) => onChange(setMemo(filter, event.target.value))}
        />
        <div className="journal-filter__range">
          <span className="journal-filter__label">期間</span>
          <input
            type="date"
            className="journal-filter__input"
            aria-label="期間の開始"
            value={filter.dateFrom ?? ''}
            onChange={(event) => onChange(setDate(filter, 'dateFrom', event.target.value))}
          />
          <span aria-hidden="true">〜</span>
          <input
            type="date"
            className="journal-filter__input"
            aria-label="期間の終了"
            value={filter.dateTo ?? ''}
            onChange={(event) => onChange(setDate(filter, 'dateTo', event.target.value))}
          />
        </div>
        <div className="journal-filter__range">
          <span className="journal-filter__label">金額</span>
          <input
            type="text"
            inputMode="numeric"
            className="journal-filter__input journal-filter__input--amount"
            aria-label="金額の下限"
            value={filter.amountMin ?? ''}
            onChange={(event) => onChange(setAmount(filter, 'amountMin', event.target.value))}
          />
          <span aria-hidden="true">〜</span>
          <input
            type="text"
            inputMode="numeric"
            className="journal-filter__input journal-filter__input--amount"
            aria-label="金額の上限"
            value={filter.amountMax ?? ''}
            onChange={(event) => onChange(setAmount(filter, 'amountMax', event.target.value))}
          />
        </div>
      </div>

      <div className="journal-filter__fields">
        {shows('account') && (
          <Field label="科目">
            <TreeSelect
              label="科目"
              categories={options.accountCategories}
              value={getTreeValue(filter, 'account')}
              onChange={(value) => onChange(setTreeValue(filter, 'account', value))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('counterparty') && (
          <Field label="取引先">
            <TreeSelect
              label="取引先"
              categories={options.counterpartyCategories}
              value={getTreeValue(filter, 'counterparty')}
              onChange={(value) => onChange(setTreeValue(filter, 'counterparty', value))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('project') && (
          <Field label="プロジェクト">
            <TreeSelect
              label="プロジェクト"
              categories={options.projectCategories}
              value={getTreeValue(filter, 'project')}
              onChange={(value) => onChange(setTreeValue(filter, 'project', value))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('member') && (
          <Field label="世帯メンバー">
            <TreeSelect
              label="世帯メンバー"
              categories={flat(options.members)}
              value={getSingleValue(filter, 'householdMemberIds')}
              onChange={(value) => onChange(setSingleValue(filter, 'householdMemberIds', value))}
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('batch') && (
          <Field label="精算バッチ">
            <TreeSelect
              label="精算バッチ"
              categories={batchCategories}
              value={getBatchValue(filter)}
              onChange={(value) => onChange(setBatchValue(filter, value))}
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('source') && (
          <Field label="出どころ">
            <TreeSelect
              label="出どころ"
              categories={flat(options.sourceTypes)}
              value={getSingleValue(filter, 'sourceTypes')}
              onChange={(value) => onChange(setSingleValue(filter, 'sourceTypes', value))}
              emptyLabel="指定なし"
            />
          </Field>
        )}
      </div>

      <div className="journal-filter__footer">
        {activeCount > 0 && (
          <button type="button" className="journal-filter__clear" onClick={() => onChange({})}>
            条件をクリア
          </button>
        )}
        {resultCount !== undefined && (
          <span role="status" className="journal-filter__count">
            {resultCount}件
          </span>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="journal-filter__field">
      <span className="journal-filter__label">{label}</span>
      {children}
    </div>
  )
}
