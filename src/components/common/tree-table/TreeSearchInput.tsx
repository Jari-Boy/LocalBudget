import { useTranslation } from 'react-i18next'

export interface TreeSearchInputProps {
  value: string
  onChange: (value: string) => void
  /** 検索対象の呼び名(例: 「科目」「取引先」)。aria-labelは「〜を検索」になる */
  leafLabel: string
}

/**
 * ツリー表の検索欄(計画Issue #219)。科目・取引先・世帯メンバー・プロジェクトのマスタ画面で共通に使い、
 * 入力した文字列で名称・表示列に一致する行だけに絞り込む(絞り込み自体は filterTreeNodes)。
 */
export function TreeSearchInput({ value, onChange, leafLabel }: TreeSearchInputProps) {
  const { t } = useTranslation('master')
  return (
    <input
      className="master-field__control"
      style={{ flex: '1 1 220px' }}
      aria-label={t('treeSearch.label', { leaf: leafLabel })}
      placeholder={t('treeSearch.placeholder')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
