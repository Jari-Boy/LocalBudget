import { useState } from 'react'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { AmountRangeInput } from '../amount-range/AmountRangeInput'
import { PeriodRangeInput } from '../period-range/PeriodRangeInput'
import { TreeSelect } from '../tree-select/TreeSelect'
import type { TreeSelectCategory } from '../tree-select/treeSelectModel'
import {
  countActiveConditions,
  getBatchValues,
  getMemberValues,
  getSourceValues,
  getTreeValues,
  hasSideConditions,
  NO_BATCH_VALUE,
  setAmount,
  setBatchValues,
  setDate,
  setMemberValues,
  setMemo,
  setSourceValues,
  setTreeValues,
  toCombinedMode,
  toSplitMode,
  type FilterScope,
} from './journalFilterModel'
import './JournalFilterPanel.css'

/** 平らな選択肢(世帯メンバー・精算バッチ・出どころ)。valueは選択ツリーの値と同じ文字列。 */
export interface JournalFilterChoice {
  value: string
  name: string
  /** 階層つきの選択肢(出どころの金融機関など、計画Issue #289)。深さ(最上位が0)と親の値。TreeSelectの階層つき項目としてインデントして並ぶ */
  depth?: number
  parentValue?: string | null
}

export interface JournalFilterOptions {
  accountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
  members: readonly JournalFilterChoice[]
  batches: readonly JournalFilterChoice[]
  sourceTypes: readonly JournalFilterChoice[]
  /** 絞り込む対象の仕訳の日付(期間を月で選ぶときの、月の選択肢を作る。計画Issue #314)。省略時は選択肢が空 */
  entryDates?: readonly string[]
  /** 絞り込む対象の仕訳の最大金額(金額のスライダーの、100万円より先の目盛りの上限になる。計画Issue #314)。省略時は0 */
  maxAmount?: number
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
    nodes: choices.map((c) => ({
      kind: 'item' as const,
      value: c.value,
      name: c.name,
      isActive: true,
      ...(c.depth === undefined ? {} : { depth: c.depth, parentValue: c.parentValue ?? null }),
    })),
  },
]

const SIDE_TITLES = { debit: '借方', credit: '貸方' } as const

/**
 * 仕訳の絞り込みパネル(計画Issue #150)。文字検索・出どころ・期間・金額・科目・取引先・プロジェクト・
 * 世帯メンバー・精算バッチを最初からすべて並べる(「条件を追加」方式にしない)。
 * 条件の状態は呼び出し側が持つ制御コンポーネントで、常時表示でもポップアップ
 * (JournalFilterPopup)の中でも使える。絞り込みの実行はドメイン層(filterJournalEntries)の責務で、
 * ここはJournalEntryFilterの生成だけを行う。各軸は複数選択で、軸の中はOR(計画Issue #203)。
 *
 * 計画Issue #314: 期間は「日付で指定」のチェックで日付・月を切り替えられる。金額は数字入力に加えて2つ摘みのスライダーで
 * 指定できる。科目・取引先・プロジェクト・世帯メンバー・精算バッチは、緑の枠の中の「借方・貸方を分けて検索」のチェックで、
 * まとめて指定する形と、借方・貸方に分けて指定する形を切り替えられる(切り替えると競合する条件は消える)。
 * 出どころは仕訳単位の条件なので分けず、摘要の隣に置く。
 */
export function JournalFilterPanel({ filter, onChange, options, resultCount, hide = [] }: JournalFilterPanelProps) {
  const [split, setSplit] = useState(() => hasSideConditions(filter))
  const activeCount = countActiveConditions(filter)
  const shows = (key: JournalFilterFieldKey) => !hide.includes(key)
  const batchCategories = flat([{ value: NO_BATCH_VALUE, name: '未割当' }, ...options.batches])

  const switchSplit = (next: boolean) => {
    setSplit(next)
    const converted = next ? toSplitMode(filter) : toCombinedMode(filter)
    if (JSON.stringify(converted) !== JSON.stringify(filter)) onChange(converted)
  }

  /** 科目・取引先・プロジェクト・世帯メンバー・精算バッチの5つの選択欄。範囲(まとめて・借方・貸方)ごとに同じ並びで出す */
  const axisFields = (scope: FilterScope) => {
    const prefix = scope === 'both' ? '' : SIDE_TITLES[scope]
    const name = (label: string) => (prefix === '' ? label : `${prefix}の${label}`)
    return (
      <div className="journal-filter__fields">
        {shows('account') && (
          <Field label="科目">
            <TreeSelect
              label={name('科目')}
              categories={options.accountCategories}
              favoriteKind="account"
              multiple
              values={getTreeValues(filter, 'account', scope)}
              onValuesChange={(values) => onChange(setTreeValues(filter, 'account', values, scope))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('counterparty') && (
          <Field label="取引先">
            <TreeSelect
              label={name('取引先')}
              categories={options.counterpartyCategories}
              favoriteKind="counterparty"
              multiple
              values={getTreeValues(filter, 'counterparty', scope)}
              onValuesChange={(values) => onChange(setTreeValues(filter, 'counterparty', values, scope))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('project') && (
          <Field label="プロジェクト">
            <TreeSelect
              label={name('プロジェクト')}
              categories={options.projectCategories}
              favoriteKind="project"
              multiple
              values={getTreeValues(filter, 'project', scope)}
              onValuesChange={(values) => onChange(setTreeValues(filter, 'project', values, scope))}
              allowGroupSelect
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('member') && (
          <Field label="世帯メンバー">
            <TreeSelect
              label={name('世帯メンバー')}
              categories={flat(options.members)}
              multiple
              values={getMemberValues(filter, scope)}
              onValuesChange={(values) => onChange(setMemberValues(filter, values, scope))}
              emptyLabel="指定なし"
            />
          </Field>
        )}
        {shows('batch') && (
          <Field label="精算バッチ">
            <TreeSelect
              label={name('精算バッチ')}
              categories={batchCategories}
              multiple
              values={getBatchValues(filter, scope)}
              onValuesChange={(values) => onChange(setBatchValues(filter, values, scope))}
              emptyLabel="指定なし"
            />
          </Field>
        )}
      </div>
    )
  }

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
        {shows('source') && (
          <div className="journal-filter__range">
            <span className="journal-filter__label">出どころ</span>
            <div className="journal-filter__source">
              <TreeSelect
                label="出どころ"
                categories={flat(options.sourceTypes)}
                multiple
                values={getSourceValues(filter)}
                onValuesChange={(values) => onChange(setSourceValues(filter, values))}
                emptyLabel="指定なし"
              />
            </div>
          </div>
        )}
        <PeriodRangeInput
          label="期間"
          fromLabel="期間の開始"
          toLabel="期間の終了"
          byDateLabel="日付で指定"
          unsetLabel="指定なし"
          from={filter.dateFrom ?? ''}
          to={filter.dateTo ?? ''}
          dates={options.entryDates ?? []}
          onChange={(from, to) => onChange(setDate(setDate(filter, 'dateFrom', from), 'dateTo', to))}
        />
      </div>
      <div className="journal-filter__row">
        <AmountRangeInput
          label="金額"
          minLabel="金額の下限"
          maxLabel="金額の上限"
          noLimitLabel="上限なし"
          minText={filter.amountMin === undefined ? '' : String(filter.amountMin)}
          maxText={filter.amountMax === undefined ? '' : String(filter.amountMax)}
          dataMax={options.maxAmount ?? 0}
          onMinTextChange={(text) => onChange(setAmount(filter, 'amountMin', text))}
          onMaxTextChange={(text) => onChange(setAmount(filter, 'amountMax', text))}
        />
      </div>

      <div className="journal-filter__axes" role="group" aria-label="科目などの条件">
        <label className="period-range__check">
          <input type="checkbox" checked={split} onChange={(event) => switchSplit(event.target.checked)} />
          借方・貸方を分けて検索
        </label>
        {split ? (
          <div className="journal-filter__sides">
            {(['debit', 'credit'] as const).map((side) => (
              <div key={side} className="journal-filter__side" role="group" aria-label={`${SIDE_TITLES[side]}の条件`}>
                <span className="journal-filter__side-title">{SIDE_TITLES[side]}</span>
                {axisFields(side)}
              </div>
            ))}
          </div>
        ) : (
          axisFields('both')
        )}
      </div>

      <div className="journal-filter__footer">
        {activeCount > 0 && (
          <button type="button" className="journal-filter__clear" onClick={() => onChange({})}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
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
