import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeFinancialInstitutionName } from '../../domain/statement-import/financialInstitution'

const NEW = '__new__'

export interface FinancialInstitutionSelectProps {
  id: string
  className: string
  /** 現在の金融機関名(未選択は空文字) */
  value: string
  /** 選択候補(既存の定義にある金融機関名。重複なし) */
  candidates: readonly string[]
  onChange: (value: string) => void
}

/**
 * 金融機関名(format_group_id)の選択欄(計画Issue #183)。マスタの「明細マッピング」タブと
 * 取込画面のマッピング作成ダイアログで共通に使う。既存の金融機関名から選ばせ、候補にない場合だけ
 * 「新しい金融機関名を入力…」で入力欄を出す。入力した名前が候補と表記ゆれ(全角半角・空白)だけの
 * 違いなら、候補の名前に寄せて通知する(別グループになるのを防ぐ)。
 */
export function FinancialInstitutionSelect({ id, className, value, candidates, onChange }: FinancialInstitutionSelectProps) {
  const { t } = useTranslation('master')
  const [creating, setCreating] = useState(false)
  const isNew = creating || (value !== '' && !candidates.includes(value))

  const onSelect = (selected: string) => {
    if (selected === NEW) {
      setCreating(true)
      onChange('')
      return
    }
    setCreating(false)
    onChange(selected)
  }

  const onType = (typed: string) => {
    const normalized = normalizeFinancialInstitutionName(typed)
    const existing = candidates.find((c) => normalizeFinancialInstitutionName(c) === normalized)
    onChange(existing ?? typed)
  }

  return (
    <>
      <select id={id} className={className} value={isNew ? NEW : value} onChange={(e) => onSelect(e.target.value)}>
        <option value="">{t('mappingTab.formatGroupChoose')}</option>
        {candidates.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={NEW}>{t('mappingTab.formatGroupNew')}</option>
      </select>
      {isNew && (
        <input
          className={className}
          aria-label={t('mappingTab.formatGroupNewLabel')}
          placeholder={t('mappingTab.formatGroupNewPlaceholder')}
          value={value}
          onChange={(e) => onType(e.target.value)}
        />
      )}
    </>
  )
}
