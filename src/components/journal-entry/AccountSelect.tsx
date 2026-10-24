import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'

export interface AccountSelectProps {
  id: string
  label: string
  value: number | null
  accounts: readonly Account[]
  onChange: (accountId: number | null) => void
  /**
   * 選択肢を絞り込む述語。省略時は全科目を選択肢にする。呼び出し元の文脈ごとに
   * 異なる絞り込み条件(マニュアル仕訳のisManualEntryEligibleAccount、CSV取込レビューの
   * isStatementImportCounterAccountEligible等)を注入できるようにし、共通化にあたって
   * 文脈ごとの要件を壊さないようにする(計画Issue #125 懸念点「勘定科目セレクトの選択肢
   * フィルタ条件の不一致」対応)。filterで除外されていても、現在のvalueと一致する科目は
   * 選択肢から取り除かない(非アクティブ化後も既存の選択値を表示し続けるため、呼び出し元が
   * filterにisActive判定を含める場合でもこの性質は呼び出し元で意識する必要がない)。
   */
  filter?: (account: Account) => boolean
  disabled?: boolean
  /** ラベル解決に使う名前空間(CounterpartyQuickAddSelectと同じ設計、unselectedキーを解決する) */
  i18nNamespace: string
}

/**
 * 勘定科目セレクト(計画Issue #125)。JournalEntryForm・JournalEntryDetailScreenの
 * Linesテーブル双方から共通利用する。元々は画面ごとに生`<select>`を個別実装していたが、
 * 見た目・挙動の重複を解消するために切り出した。
 */
export function AccountSelect({
  id,
  label,
  value,
  accounts,
  onChange,
  filter,
  disabled,
  i18nNamespace,
}: AccountSelectProps) {
  const { t } = useTranslation(i18nNamespace)

  const options = accounts.filter((account) => (filter ? filter(account) || account.id === value : true))

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">{t('unselected')}</option>
        {options.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
    </>
  )
}
