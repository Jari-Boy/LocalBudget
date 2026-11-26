import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { EntityGroup } from '../common/entity-select/EntitySelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { countRowsContaining, mostFrequentAccountId, validateKeyword } from './counterpartyKeywordModel'
import { KeywordList, type KeywordListItem } from './KeywordList'
import { QuickCreateDialog } from './QuickCreateDialog'

export interface CounterpartyCreateInput {
  name: string
  groupId: number | null
  /** 取引先に登録するキーワードと、そのキーワードに紐づける科目(費用・収益。なければnull。空のキーワードは除く、前後の空白は除いた入力のまま。計画Issue #219) */
  keywords: { text: string; accountId: number | null }[]
  /** 追加と同時に、キーワードを含む未設定のほかの行へ取引先と相手科目の初期値を反映するか(計画Issue #218) */
  applyToOtherRows: boolean
}

export interface CounterpartyCreateDialogProps {
  /** ダイアログを開いた行の摘要。取引先名と最初のキーワードの初期値になる(摘要に含まれないキーワードも登録できる。計画Issue #236) */
  rowDescription: string
  /** ダイアログを開いた行の相手科目(取引先を持てない科目なら未設定)。最初のキーワード(行の摘要)の科目の初期値になる */
  rowAccountId: number | null
  /** 「含む行の数」の対象にする、未確定の行の摘要 */
  descriptions: readonly string[]
  groups: readonly EntityGroup[]
  /** 取引先グループをその場で作る(名前と親グループ。nullなら最上位)。作ったグループのidを返す */
  onCreateGroup: (name: string, parentGroupId: number | null) => Promise<number>
  accountCategories: readonly TreeSelectCategory[]
  /**
   * 渡すと、各キーワードの科目の選択肢の末尾に「+ 科目を新規追加」を出す(計画Issue #218)。
   * 押すと呼び出し側が科目の登録を開き、登録できたらその科目のidでonCreatedを呼ぶ
   */
  onCreateAccount?: (onCreated: (accountId: number) => void) => void
  onSubmit: (input: CounterpartyCreateInput) => Promise<void>
  onCancel: () => void
}

interface KeywordInput {
  key: string
  text: string
  accountId: number | null
}

/**
 * 明細取込画面の「取引先を追加」ダイアログ(計画Issue #207)。取引先名とグループに加えて、キーワードと
 * キーワードと科目のセットをまとめて設定できる(計画Issue #219)。キーワードの一覧は取引先の設定ポップアップと同じ部品を使う。
 * 追加を押すと、呼び出し側が取引先・キーワード(と科目)をまとめて保存する。
 */
export function CounterpartyCreateDialog(props: CounterpartyCreateDialogProps) {
  const {
    rowDescription,
    rowAccountId,
    descriptions,
    groups,
    onCreateGroup,
    accountCategories,
    onCreateAccount,
    onSubmit,
    onCancel,
  } = props
  const { t } = useTranslation('statementImport')
  const [keywords, setKeywords] = useState<KeywordInput[]>(
    rowDescription.trim() === '' ? [] : [{ key: 'k0', text: rowDescription.trim(), accountId: rowAccountId }],
  )
  const [nextKey, setNextKey] = useState(1)
  const [applyToOtherRows, setApplyToOtherRows] = useState(true)

  const setKeywordAccount = (key: string, accountId: number | null) =>
    setKeywords((prev) => prev.map((k) => (k.key === key ? { ...k, accountId } : k)))

  // 入力前の空欄は無視する。それ以外の問題(重複)はその場に出し、追加を止める。摘要にマッチしないものは注意だけで、止めない
  const items: KeywordListItem[] = keywords.map((keyword) => ({
    key: keyword.key,
    kind: 'new',
    text: keyword.text,
    accountId: keyword.accountId,
    count: countRowsContaining(keyword.text, descriptions),
    error:
      keyword.text.trim() === ''
        ? null
        : validateKeyword({
            text: keyword.text,
            otherTexts: keywords.filter((other) => other.key !== keyword.key).map((other) => other.text),
          }),
  }))

  return (
    <QuickCreateDialog
      title={t('createCounterpartyTitle')}
      nameLabel={t('createCounterpartyName')}
      initialName={rowDescription.trim()}
      groupField={{ label: t('counterpartyGroupLabel'), groups, onCreate: onCreateGroup }}
      validate={() => items.every((item) => item.error === null)}
      onSubmit={(name, groupId) =>
        onSubmit({
          name,
          groupId,
          keywords: keywords
            .map((keyword) => ({ text: keyword.text.trim(), accountId: keyword.accountId }))
            .filter((keyword) => keyword.text !== ''),
          applyToOtherRows,
        })
      }
      onCancel={onCancel}
    >
      <KeywordList
        items={items}
        onTextChange={(key, text) => setKeywords((prev) => prev.map((k) => (k.key === key ? { ...k, text } : k)))}
        onCommit={() => undefined}
        onDelete={(key) => setKeywords((prev) => prev.filter((k) => k.key !== key))}
        onAdd={() => {
          // 科目の初期値は、ダイアログ内のキーワードで最も多く使われている科目(同数なら指定なし。計画Issue #236)
          setKeywords((prev) => [...prev, { key: `k${nextKey}`, text: '', accountId: mostFrequentAccountId(prev.map((k) => k.accountId)) }])
          setNextKey((n) => n + 1)
        }}
        // キーワードと科目のセットで入力する。科目の選択欄は行ごとに出し、末尾の「+ 科目を新規追加」で登録もできる
        renderAccount={(item, index) => (
          <TreeSelect
            label={t('patternAccountLabel', { index: index + 1 })}
            categories={accountCategories}
            favoriteKind="account"
            value={item.accountId == null ? '' : String(item.accountId)}
            emptyLabel={t('defaultAccountNone')}
            placeholder={t('defaultAccountNone')}
            onChange={(v) => setKeywordAccount(item.key, v === '' ? null : Number(v))}
            onCreate={onCreateAccount ? () => onCreateAccount((created) => setKeywordAccount(item.key, created)) : undefined}
            createLabel={t('createCounterAccount')}
          />
        )}
      />
      <div className="import-field">
        <label className="import-check">
          <input type="checkbox" checked={applyToOtherRows} onChange={(e) => setApplyToOtherRows(e.target.checked)} />
          {t('applyToOtherRowsOption')}
        </label>
        <span className="import-note">{t('applyToOtherRowsNote')}</span>
      </div>
    </QuickCreateDialog>
  )
}
