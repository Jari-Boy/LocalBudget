import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { countRowsContaining, validateKeyword } from './counterpartyKeywordModel'
import { KeywordList, type KeywordListItem } from './KeywordList'
import { QuickCreateDialog } from './QuickCreateDialog'

export interface CounterpartyCreateInput {
  name: string
  groupId: number | null
  /** 取引先に登録するキーワード(空は除く、前後の空白は除いた入力のまま) */
  keywords: string[]
  defaultAccountId: number | null
}

export interface CounterpartyCreateDialogProps {
  /** ダイアログを開いた行の摘要。最初のキーワードの初期値になり、新しいキーワードはこの摘要に含まれる文字列に限る */
  rowDescription: string
  /** ダイアログを開いた行の相手科目(取引先を持てない科目なら未設定)。相手科目の初期値の初期値になる */
  rowAccountId: number | null
  /** 「含む行の数」の対象にする、未確定の行の摘要 */
  descriptions: readonly string[]
  groupCategories: readonly TreeSelectCategory[]
  /** 取引先グループをその場で作る(名前だけ、最上位)。作ったグループのidを返す */
  onCreateGroup: (name: string) => Promise<number>
  accountCategories: readonly TreeSelectCategory[]
  onSubmit: (input: CounterpartyCreateInput) => Promise<void>
  onCancel: () => void
}

interface KeywordInput {
  key: string
  text: string
}

/**
 * 明細取込画面の「取引先を追加」ダイアログ(計画Issue #207)。取引先名とグループに加えて、キーワードと
 * 相手科目の初期値もまとめて設定できる。キーワードの一覧は取引先の設定ポップアップと同じ部品を使う。
 * 追加を押すと、呼び出し側が取引先・キーワード・相手科目の初期値をまとめて保存する。
 */
export function CounterpartyCreateDialog(props: CounterpartyCreateDialogProps) {
  const { rowDescription, rowAccountId, descriptions, groupCategories, onCreateGroup, accountCategories, onSubmit, onCancel } = props
  const { t } = useTranslation('statementImport')
  const [keywords, setKeywords] = useState<KeywordInput[]>(
    rowDescription.trim() === '' ? [] : [{ key: 'k0', text: rowDescription.trim() }],
  )
  const [nextKey, setNextKey] = useState(1)
  const [defaultAccountId, setDefaultAccountId] = useState<number | null>(rowAccountId)

  // 入力前の空欄は無視する。それ以外の問題(重複・摘要に含まれない)はその場に出し、追加を止める
  const items: KeywordListItem[] = keywords.map((keyword) => ({
    key: keyword.key,
    kind: 'new',
    text: keyword.text,
    count: countRowsContaining(keyword.text, descriptions),
    error:
      keyword.text.trim() === ''
        ? null
        : validateKeyword({
            text: keyword.text,
            otherTexts: keywords.filter((other) => other.key !== keyword.key).map((other) => other.text),
            sourceDescription: rowDescription,
          }),
  }))

  return (
    <QuickCreateDialog
      title={t('createCounterpartyTitle')}
      nameLabel={t('createCounterpartyName')}
      groupField={{ label: t('counterpartyGroupLabel'), categories: groupCategories, onCreate: onCreateGroup }}
      validate={() => items.every((item) => item.error === null)}
      onSubmit={(name, groupId) =>
        onSubmit({
          name,
          groupId,
          keywords: keywords.map((keyword) => keyword.text.trim()).filter((text) => text !== ''),
          defaultAccountId,
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
          setKeywords((prev) => [...prev, { key: `k${nextKey}`, text: '' }])
          setNextKey((n) => n + 1)
        }}
      />
      <div className="import-field import-settings__section">
        <span className="import-field__label">{t('defaultAccountLabel')}</span>
        <TreeSelect
          label={t('defaultAccountLabel')}
          categories={accountCategories}
          value={defaultAccountId === null ? '' : String(defaultAccountId)}
          emptyLabel={t('defaultAccountNone')}
          placeholder={t('defaultAccountNone')}
          onChange={(v) => setDefaultAccountId(v === '' ? null : Number(v))}
        />
      </div>
    </QuickCreateDialog>
  )
}
